import { z } from 'zod'
import { config, hasVisionKey } from '@/lib/config'
import { logEvent } from '@/lib/mcp/pii'
import { guessCategory, normalizeProductName } from '@/lib/domain/normalize'

/**
 * Розпізнавання продуктів на фото через Claude multimodal.
 *
 * Structured output реалізовано через forced tool use: модель зобовʼязана
 * викликати інструмент `report_pantry_items`, схема якого згенерована з Zod.
 * Це надійніше за «поверни JSON у тексті» — не треба чистити markdown-огорожі.
 *
 * Головна чесність цього модуля: фото фізично не дає ані ваги, ані вмісту
 * закритої упаковки, ані терміну придатності. Тому кожна позиція має
 * confidence і прапорець needsConfirmation, а модель прямо інструктована
 * не вигадувати те, чого не видно.
 */

export const RecognizedItemSchema = z.object({
  name: z.string().min(1).describe('Назва продукту українською, як її назвав би покупець'),
  category: z.string().describe('Категорія: Молочні продукти, Овочі та фрукти, Бакалія, Напої, Мʼясо та риба, Снеки, Інше'),
  estimatedQuantity: z.number().positive().describe('Приблизна кількість. Якщо не видно — розумна оцінка для типової упаковки'),
  unit: z.enum(['г', 'кг', 'мл', 'л', 'шт']).describe('Одиниця виміру'),
  brand: z.string().nullable().describe('Бренд, якщо його чітко видно на упаковці, інакше null'),
  expiryDateText: z.string().nullable().describe('Текст терміну придатності, якщо його ВИДНО на фото, інакше null'),
  confidence: z.number().min(0).max(1).describe('Впевненість 0..1. Нижче 0.6 для часткового або перекритого обʼєкта'),
  needsConfirmation: z.boolean().describe('true, якщо кількість/вміст оцінені приблизно'),
})

export const RecognitionResultSchema = z.object({
  items: z.array(RecognizedItemSchema),
})

export type RecognizedItem = z.infer<typeof RecognizedItemSchema>
export type RecognitionResult = z.infer<typeof RecognitionResultSchema>

export interface VisionOutcome extends RecognitionResult {
  /** 'claude' — справжній виклик моделі; 'demo' — детермінований аналізатор */
  engine: 'claude' | 'demo'
  /** пояснення, чому саме такий engine — показуємо користувачу */
  note: string
}

const SYSTEM_PROMPT = `Ти — асистент, який розпізнає продукти на фотографіях холодильника, полиць і кухонних шаф.

Правила:
1. Перелічуй лише те, що реально видно. Не вигадуй продукти «які зазвичай є в холодильнику».
2. Кількість оцінюй консервативно. Ти НЕ можеш знати вагу або вміст закритої упаковки — став needsConfirmation: true.
3. Термін придатності вказуй ЛИШЕ якщо він фізично читається на фото. Інакше null.
4. confidence знижуй для перекритих, розмитих або частково видимих обʼєктів.
5. Назви — українською, у формі, зрозумілій покупцю («Молоко», а не «Молочний продукт пастеризований»).
6. Якщо на фото немає їжі — поверни порожній список items.
7. Не роби висновків про свіжість чи придатність продукту до вживання.`

/** JSON Schema для forced tool use — тримаємо руками, бо вона мала і має бути точною. */
const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
          estimatedQuantity: { type: 'number' },
          unit: { type: 'string', enum: ['г', 'кг', 'мл', 'л', 'шт'] },
          brand: { type: ['string', 'null'] },
          expiryDateText: { type: ['string', 'null'] },
          confidence: { type: 'number' },
          needsConfirmation: { type: 'boolean' },
        },
        required: ['name', 'category', 'estimatedQuantity', 'unit', 'brand', 'expiryDateText', 'confidence', 'needsConfirmation'],
      },
    },
  },
  required: ['items'],
} as const

export interface PhotoInput {
  base64: string
  mime: string
  /** що саме на фото — допомагає моделі й покращує оцінку кількості */
  hint?: 'fridge' | 'shelf' | 'cupboard' | 'package' | 'other'
}

const HINT_TEXT: Record<NonNullable<PhotoInput['hint']>, string> = {
  fridge: 'Це фото відкритого холодильника.',
  shelf: 'Це фото окремої полиці.',
  cupboard: 'Це фото кухонної шафи з бакалією.',
  package: 'Це крупний план упаковки одного товару — уважно прочитай назву, вагу і термін придатності.',
  other: '',
}

export async function analyzePantryPhotos(photos: PhotoInput[]): Promise<VisionOutcome> {
  if (photos.length === 0) return { items: [], engine: 'demo', note: 'Фото не надано' }

  if (!hasVisionKey()) {
    return {
      ...demoRecognition(photos),
      engine: 'demo',
      note: 'ANTHROPIC_API_KEY не задано — показано демонстраційний результат розпізнавання',
    }
  }

  try {
    const result = await callClaude(photos)
    return { ...result, engine: 'claude', note: `Розпізнано моделлю ${config.anthropic.visionModel}` }
  } catch (err) {
    logEvent('warn', 'vision.failed', { message: err instanceof Error ? err.message : String(err) })
    return {
      ...demoRecognition(photos),
      engine: 'demo',
      note: `AI-розпізнавання недоступне (${err instanceof Error ? err.message : 'помилка'}) — показано демонстраційний результат`,
    }
  }
}

async function callClaude(photos: PhotoInput[]): Promise<RecognitionResult> {
  const content: unknown[] = []
  photos.forEach((photo, index) => {
    content.push({ type: 'text', text: `Фото ${index + 1}. ${HINT_TEXT[photo.hint ?? 'other']}`.trim() })
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: photo.mime, data: photo.base64 },
    })
  })
  content.push({
    type: 'text',
    text: 'Перелічи всі продукти, які видно на цих фото. Виклич інструмент report_pantry_items рівно один раз.',
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.anthropic.visionModel,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'report_pantry_items',
            description: 'Повертає структурований перелік розпізнаних продуктів',
            input_schema: TOOL_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'report_pantry_items' },
        messages: [{ role: 'user', content }],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 200)}`)
    }
    const data = (await res.json()) as { content: { type: string; name?: string; input?: unknown }[] }
    const toolUse = data.content?.find((c) => c.type === 'tool_use' && c.name === 'report_pantry_items')
    if (!toolUse?.input) throw new Error('Модель не повернула структурований результат')

    const parsed = RecognitionResultSchema.safeParse(toolUse.input)
    if (!parsed.success) throw new Error(`Результат не пройшов валідацію: ${parsed.error.issues[0]?.message}`)
    return parsed.data
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Детермінований demo-аналізатор.
 *
 * Він НЕ вдає розпізнавання: повертає фіксований набір продуктів
 * демонстраційного холодильника, а UI поруч показує бейдж DEMO і note.
 * Варіація за розміром файлу потрібна лише для того, щоб два різні фото
 * у демонстрації не дали ідентичний список.
 */
function demoRecognition(photos: PhotoInput[]): RecognitionResult {
  const base: RecognizedItem[] = [
    { name: 'Молоко', category: 'Молочні продукти', estimatedQuantity: 0.7, unit: 'л', brand: null, expiryDateText: null, confidence: 0.88, needsConfirmation: true },
    { name: 'Яйця', category: 'Яйця', estimatedQuantity: 6, unit: 'шт', brand: null, expiryDateText: null, confidence: 0.93, needsConfirmation: true },
    { name: 'Шпинат', category: 'Овочі та фрукти', estimatedQuantity: 150, unit: 'г', brand: null, expiryDateText: 'до завтра', confidence: 0.71, needsConfirmation: true },
    { name: 'Помідори', category: 'Овочі та фрукти', estimatedQuantity: 3, unit: 'шт', brand: null, expiryDateText: null, confidence: 0.82, needsConfirmation: true },
    { name: 'Масло вершкове', category: 'Молочні продукти', estimatedQuantity: 120, unit: 'г', brand: null, expiryDateText: null, confidence: 0.66, needsConfirmation: true },
    { name: 'Маскарпоне', category: 'Молочні продукти', estimatedQuantity: 250, unit: 'г', brand: null, expiryDateText: null, confidence: 0.74, needsConfirmation: true },
  ]
  const extra: RecognizedItem[] = [
    { name: 'Сир твердий', category: 'Молочні продукти', estimatedQuantity: 180, unit: 'г', brand: null, expiryDateText: null, confidence: 0.61, needsConfirmation: true },
    { name: 'Цибуля', category: 'Овочі та фрукти', estimatedQuantity: 2, unit: 'шт', brand: null, expiryDateText: null, confidence: 0.79, needsConfirmation: true },
  ]
  const take = photos.length > 1 ? base.length + Math.min(extra.length, photos.length - 1) : base.length
  return { items: [...base, ...extra].slice(0, take) }
}

/**
 * Перетворює текст терміну придатності на дату.
 * Свідомо консервативно: якщо не впевнені — повертаємо null,
 * бо хибна дата гірша за відсутню.
 */
export function parseExpiryText(text: string | null, now: Date = new Date()): Date | null {
  if (!text) return null
  const t = text.toLowerCase().trim()
  if (t.includes('сьогодні')) return atEndOfDay(now)
  if (t.includes('завтра')) return atEndOfDay(addDays(now, 1))
  if (t.includes('післязавтра')) return atEndOfDay(addDays(now, 2))

  const dmy = /(\d{1,2})[./](\d{1,2})[./](\d{2,4})/.exec(t)
  if (dmy) {
    const [, d, m, y] = dmy
    const year = y.length === 2 ? 2000 + Number(y) : Number(y)
    const date = new Date(year, Number(m) - 1, Number(d), 23, 59, 59)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const dm = /(\d{1,2})[./](\d{1,2})\b/.exec(t)
  if (dm) {
    const date = new Date(now.getFullYear(), Number(dm[2]) - 1, Number(dm[1]), 23, 59, 59)
    // якщо дата вже минула — ймовірно, йдеться про наступний рік
    if (date.getTime() < now.getTime() - 86_400_000 * 30) date.setFullYear(now.getFullYear() + 1)
    return date
  }
  const inDays = /через\s+(\d+)\s+д/.exec(t)
  if (inDays) return atEndOfDay(addDays(now, Number(inDays[1])))
  return null
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function atEndOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 0)
  return d
}

/** Доповнює розпізнану позицію нормалізацією та категоризацією. */
export function enrichRecognizedItem(item: RecognizedItem, now: Date = new Date()) {
  const normalizedName = normalizeProductName(item.name)
  const guess = guessCategory(normalizedName)
  return {
    normalizedName,
    originalName: item.name,
    category: item.category || guess.category,
    storageLocation: guess.storageLocation,
    quantity: item.estimatedQuantity,
    unit: item.unit,
    expiryDate: parseExpiryText(item.expiryDateText, now),
    confidence: item.confidence,
    needsConfirmation: item.needsConfirmation || item.confidence < 0.85,
    brand: item.brand,
  }
}
