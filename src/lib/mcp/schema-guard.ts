import type { McpToolDefinition } from './client'

/**
 * SchemaGuard — захист від головного ризику інтеграції:
 * «модель вигадала аргумент, якого в MCP-схемі немає».
 *
 * Ми не знаємо наперед точних назв і схем 39 інструментів «Сільпо».
 * Тому:
 *   1) реальний перелік беремо з tools/list у рантаймі;
 *   2) назву інструмента резолвимо за списком кандидатів + нечітким пошуком;
 *   3) аргументи перед відправкою валідуємо проти отриманої JSON Schema
 *      і відкидаємо все, чого в схемі немає, замість того щоб отримати 400.
 */

export interface ToolRegistry {
  byName: Map<string, McpToolDefinition>
  all: McpToolDefinition[]
}

export function buildRegistry(tools: McpToolDefinition[]): ToolRegistry {
  return { byName: new Map(tools.map((t) => [t.name, t])), all: tools }
}

/**
 * Знаходить інструмент за списком очікуваних назв.
 * Якщо точного збігу немає — шукає за ключовими словами,
 * бо назви на кшталт `silpo_find_products_batch` можуть відрізнятися
 * у поточній версії сервера.
 */
export function resolveTool(
  registry: ToolRegistry,
  candidates: string[],
  keywords: string[] = [],
): McpToolDefinition | null {
  for (const name of candidates) {
    const exact = registry.byName.get(name)
    if (exact) return exact
  }
  const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const candidateKeys = candidates.map(normalized)
  for (const tool of registry.all) {
    if (candidateKeys.includes(normalized(tool.name))) return tool
  }
  if (keywords.length > 0) {
    const scored = registry.all
      .map((tool) => {
        const hay = `${tool.name} ${tool.description ?? ''}`.toLowerCase()
        const score = keywords.filter((k) => hay.includes(k.toLowerCase())).length
        return { tool, score }
      })
      .filter((x) => x.score === keywords.length)
      .sort((a, b) => a.tool.name.length - b.tool.name.length)
    if (scored[0]) return scored[0].tool
  }
  return null
}

export interface ValidationResult {
  ok: boolean
  /** аргументи, очищені під схему */
  args: Record<string, unknown>
  errors: string[]
  /** ключі, які ми відкинули, бо їх немає у схемі */
  dropped: string[]
}

type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  enum?: unknown[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
}

/**
 * Валідує та очищає аргументи під inputSchema інструмента.
 * Свідомо м'яка валідація: наша задача — не відтворити повний JSON Schema,
 * а зловити три реальні класи помилок (відсутнє обовʼязкове поле,
 * вигаданий ключ, груба невідповідність типу) до мережевого виклику.
 */
export function validateArgs(tool: McpToolDefinition, args: Record<string, unknown>): ValidationResult {
  const schema = (tool.inputSchema ?? {}) as JsonSchema
  const errors: string[] = []
  const dropped: string[] = []

  if (!schema.properties) {
    return { ok: true, args, errors, dropped }
  }

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue
    const propSchema = schema.properties[key]
    if (!propSchema) {
      if (schema.additionalProperties === false) {
        dropped.push(key)
        continue
      }
      cleaned[key] = value
      continue
    }
    const typeError = checkType(propSchema, value, key)
    if (typeError) errors.push(typeError)
    // Масиви обʼєктів перевіряємо поелементно: саме тут ховалась дірка —
    // `products: [{productId, quantity}]` проходив валідацію, хоча схема
    // «Сільпо» вимагає ще companyId і branchId для кожного товару.
    errors.push(...checkArrayItems(propSchema, value, key))
    cleaned[key] = value
  }

  for (const req of schema.required ?? []) {
    if (cleaned[req] === undefined) errors.push(`відсутнє обовʼязкове поле «${req}»`)
  }

  return { ok: errors.length === 0, args: cleaned, errors, dropped }
}

/**
 * Перевіряє обовʼязкові поля в елементах масиву. Без цього SchemaGuard
 * давав хибне відчуття безпеки: верхній рівень валідний, а сервер
 * усе одно відповідає -32602 через неповний елемент.
 */
function checkArrayItems(schema: JsonSchema, value: unknown, path: string): string[] {
  if (schema.type !== 'array' || !Array.isArray(value)) return []
  const itemSchema = schema.items
  if (!itemSchema || itemSchema.type !== 'object') return []
  const required = itemSchema.required ?? []
  if (required.length === 0) return []

  const errors: string[] = []
  value.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) {
      errors.push(`«${path}[${index}]» має бути обʼєктом`)
      return
    }
    const obj = item as Record<string, unknown>
    for (const key of required) {
      if (obj[key] === undefined || obj[key] === null) {
        errors.push(`«${path}[${index}]»: відсутнє обовʼязкове поле «${key}»`)
      }
    }
  })
  return errors
}

function checkType(schema: JsonSchema, value: unknown, path: string): string | null {
  if (schema.anyOf || schema.oneOf) return null // не розкручуємо union — надто легко дати хибний негатив
  if (schema.enum && !schema.enum.includes(value as never)) {
    return `«${path}»: значення ${JSON.stringify(value)} не входить у дозволені ${JSON.stringify(schema.enum)}`
  }
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? null : `«${path}» має бути рядком`
    case 'number':
    case 'integer':
      return typeof value === 'number' ? null : `«${path}» має бути числом`
    case 'boolean':
      return typeof value === 'boolean' ? null : `«${path}» має бути boolean`
    case 'array':
      return Array.isArray(value) ? null : `«${path}» має бути масивом`
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? null
        : `«${path}» має бути обʼєктом`
    default:
      return null
  }
}

/** Компактний опис схеми для UI/трейсу — щоб було видно, що ми її справді читали. */
export function describeSchema(tool: McpToolDefinition): { required: string[]; properties: string[] } {
  const schema = (tool.inputSchema ?? {}) as JsonSchema
  return {
    required: schema.required ?? [],
    properties: Object.keys(schema.properties ?? {}),
  }
}
