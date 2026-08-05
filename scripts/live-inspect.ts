/**
 * Інспекція ЖИВОГО MCP «Сільпо» з токеном поточної сесії.
 *
 *   npm run mcp:inspect            — схеми ключових інструментів
 *   npm run mcp:inspect -- --call  — плюс read-only виклики
 *
 * Виконує ВИКЛЮЧНО read-операції. Жодних змін кошика чи обраного.
 * Результат маскується через lib/mcp/pii перед виводом.
 */

import { PrismaClient } from '@prisma/client'
import { McpHttpClient, extractToolJson, type McpToolDefinition } from '../src/lib/mcp/client'
import { sanitizeForTrace } from '../src/lib/mcp/pii'

/** Інструменти, на які спирається агент. Саме їх треба звірити зі схемами. */
const KEY_TOOLS = [
  'silpo_get_my_profile',
  'silpo_get_my_family',
  'silpo_get_my_food_restrictions',
  'silpo_get_my_offline_orders',
  'silpo_get_my_online_orders',
  'silpo_get_loyalty_info',
  'silpo_get_my_coupons',
  'silpo_get_my_promos',
  'silpo_find_products_batch',
  'silpo_get_product_details',
  'silpo_get_replacements',
  'silpo_get_my_shopping_cart',
  'silpo_get_time_slots',
  'silpo_add_or_update_cart_products',
  'silpo_remove_cart_products',
]

/** Безпечні read-only виклики без обовʼязкових аргументів. */
const SAFE_CALLS = [
  'silpo_get_my_profile',
  'silpo_get_my_family',
  'silpo_get_my_food_restrictions',
  'silpo_get_loyalty_info',
  'silpo_get_my_offline_orders',
  'silpo_get_my_shopping_cart',
]

const prisma = new PrismaClient()

/** Мережа до mcp.silpo.ua іноді дає одиничний збій — пробуємо ще раз. */
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (i < attempts) {
        console.log(`   ↻ ${label}: спроба ${i} невдала, повторюю…`)
        await new Promise((r) => setTimeout(r, 1200 * i))
      }
    }
  }
  throw lastError
}

async function main() {
  const withCalls = process.argv.includes('--call')

  const session = await prisma.mcpSession.findFirst({ orderBy: { updatedAt: 'desc' } })
  if (!session) {
    console.log('\n❌ Немає MCP-сесії. Увійдіть через «Сільпо» на /trace і повторіть.\n')
    process.exit(1)
  }
  if (session.expiresAt <= new Date()) {
    console.log(`\n❌ Токен протух ${session.expiresAt.toLocaleString('uk-UA')}. Увійдіть знову.\n`)
    process.exit(1)
  }

  console.log(`\n🔐 Токен дійсний до ${session.expiresAt.toLocaleString('uk-UA')}`)

  const client = new McpHttpClient({ url: process.env.SILPO_MCP_URL ?? 'https://mcp.silpo.ua/mcp', accessToken: session.accessToken })
  const tools = await withRetry('tools/list', () => client.listTools())

  console.log(`\n✅ tools/list → ${tools.length} інструментів\n`)
  console.log('─'.repeat(70))
  console.log('СХЕМИ КЛЮЧОВИХ ІНСТРУМЕНТІВ')
  console.log('─'.repeat(70))

  const missing: string[] = []
  for (const name of KEY_TOOLS) {
    const tool = tools.find((t) => t.name === name)
    if (!tool) {
      missing.push(name)
      console.log(`\n❌ ${name} — ВІДСУТНІЙ на сервері`)
      continue
    }
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
    const required = schema.required ?? []
    const props = Object.keys(schema.properties ?? {})
    console.log(`\n✅ ${name}`)
    console.log(`   required:   ${required.length ? required.join(', ') : '— (без обовʼязкових)'}`)
    console.log(`   properties: ${props.length ? props.join(', ') : '—'}`)
  }

  if (missing.length > 0) {
    console.log(`\n⚠️  Відсутні інструменти: ${missing.join(', ')}`)
    console.log('   Адаптер деградує в demo для відповідних сценаріїв.')
  } else {
    console.log('\n🎯 Усі ключові інструменти агента є на сервері.')
  }

  if (!withCalls) {
    console.log('\nДодайте --call, щоб виконати read-only виклики.\n')
    await prisma.$disconnect()
    return
  }

  console.log('\n' + '─'.repeat(70))
  console.log('READ-ONLY ВИКЛИКИ (форма відповіді, дані замасковані)')
  console.log('─'.repeat(70))

  for (const name of SAFE_CALLS) {
    const tool = tools.find((t) => t.name === name)
    if (!tool) continue
    const args = buildEmptyArgs(tool)
    try {
      const started = Date.now()
      const result = await withRetry(name, () => client.callTool(name, args))
      const payload = extractToolJson(result)
      console.log(`\n✅ ${name}  (${Date.now() - started} мс, args: ${JSON.stringify(args)})`)
      console.log(`   ${shape(payload)}`)
      console.log(`   ${JSON.stringify(sanitizeForTrace(payload)).slice(0, 400)}`)
    } catch (err) {
      console.log(`\n❌ ${name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log()
  await prisma.$disconnect()
}

/** Заповнює лише обовʼязкові поля розумними дефолтами. */
function buildEmptyArgs(tool: McpToolDefinition): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; default?: unknown }>
    required?: string[]
  }
  const args: Record<string, unknown> = {}
  for (const key of schema.required ?? []) {
    const prop = schema.properties?.[key]
    if (prop?.default !== undefined) args[key] = prop.default
    else if (prop?.type === 'number' || prop?.type === 'integer') args[key] = 1
    else if (prop?.type === 'boolean') args[key] = false
    else if (prop?.type === 'array') args[key] = []
    else if (prop?.type === 'object') args[key] = {}
    else args[key] = ''
  }
  return args
}

/** Короткий опис форми відповіді — саме те, під що підлаштовується адаптер. */
function shape(value: unknown, depth = 0): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `array[${value.length}]${value.length > 0 && depth < 2 ? ` of ${shape(value[0], depth + 1)}` : ''}`
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
    return `object{ ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? `, …+${keys.length - 12}` : ''} }`
  }
  return typeof value
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
