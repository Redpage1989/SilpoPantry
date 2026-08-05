import type { PantrySource, Unit } from './types'
import { guessCategory, normalizeProductName } from './normalize'
import { daysUntil } from './pantry'

/**
 * Інференс домашніх залишків з історії чеків «Сільпо».
 *
 * Це головна відмінність продукту: комора наповнюється сама, з покупок,
 * а фото лише уточнює. Але чек не знає, скільки вже зʼїли, тому тут
 * все побудовано навколо чесної оцінки, а не вигаданої точності:
 *
 *  · кількість = розмір упаковки × «залишилось» за кривою споживання;
 *  · confidence падає з часом — через тиждень ми майже нічого не знаємо;
 *  · усі позиції отримують needsConfirmation = true;
 *  · протерміноване не імпортуємо взагалі — краще пропустити, ніж
 *    підсунути користувачу зіпсований продукт у меню.
 */

export interface ReceiptLine {
  productId: string
  name: string
  quantity: number
  price: number
}

export interface ReceiptForImport {
  orderId: string
  date: string
  kind: 'online_order' | 'offline_receipt'
  items: ReceiptLine[]
}

export interface InferredPantryItem {
  normalizedName: string
  originalName: string
  category: string
  storageLocation: string
  quantity: number
  unit: Unit
  expiryDate: Date | null
  confidence: number
  needsConfirmation: true
  source: PantrySource
  productId: string
  /** пояснення для UI: звідки взялась ця позиція */
  provenance: string
}

export interface ReceiptImportDecision {
  productName: string
  normalizedName: string
  decision: 'imported' | 'skipped_expired' | 'skipped_non_food' | 'merged'
  reason: string
}

export interface ReceiptImportResult {
  items: InferredPantryItem[]
  decisions: ReceiptImportDecision[]
}

/** Типовий розмір упаковки, якщо в назві його не вказано. */
const DEFAULT_PACK: Record<string, { size: number; unit: Unit }> = {
  'молоко': { size: 900, unit: 'мл' },
  'яйця': { size: 10, unit: 'шт' },
  'масло вершкове': { size: 200, unit: 'г' },
  'маскарпоне': { size: 250, unit: 'г' },
  'сир твердий': { size: 200, unit: 'г' },
  'сир кисломолочний': { size: 400, unit: 'г' },
  'макарони': { size: 400, unit: 'г' },
  'борошно': { size: 1000, unit: 'г' },
  'цукор': { size: 1000, unit: 'г' },
  'кава': { size: 250, unit: 'г' },
  'олія': { size: 900, unit: 'мл' },
  'помідори': { size: 1000, unit: 'г' },
  'цибуля': { size: 1000, unit: 'г' },
  'часник': { size: 200, unit: 'г' },
  'шпинат': { size: 100, unit: 'г' },
  'куряче філе': { size: 500, unit: 'г' },
  'савоярді': { size: 200, unit: 'г' },
  'какао': { size: 100, unit: 'г' },
}

/** Товари, які не є продуктами і не мають потрапляти в комору. */
const NON_FOOD = ['пакет', 'мішок', 'серветк', 'мило', 'шампун', 'порошок для прання', 'губка', 'батарейк', 'зубна']

/**
 * Скільки продукту типово лишається через N днів.
 * Швидкопсувні (термін ≤7 днів) споживаються швидко, бакалія — повільно.
 */
export function remainingFraction(daysSincePurchase: number, shelfLifeDays: number): number {
  if (daysSincePurchase <= 0) return 1
  // характерний час «зʼїдання» — половина строку придатності, але не менше 2 днів
  const consumptionSpan = Math.max(2, shelfLifeDays * 0.5)
  const fraction = 1 - daysSincePurchase / consumptionSpan
  return Math.max(0, Math.min(1, Math.round(fraction * 20) / 20))
}

/** Впевненість падає з кожним днем після покупки. */
export function inferenceConfidence(daysSincePurchase: number, shelfLifeDays: number): number {
  const decay = Math.exp(-daysSincePurchase / Math.max(3, shelfLifeDays * 0.6))
  return Math.max(0.2, Math.min(0.75, Math.round(decay * 100) / 100))
}

/** Витягує розмір упаковки з назви товару: «Молоко 2,5%, 900 мл» → 900 мл. */
export function parsePackFromName(name: string): { size: number; unit: Unit } | null {
  // \b тут не працює: кирилиця не входить у ASCII-\w, тому межу слова
  // задаємо явно через lookahead на будь-яку літеру.
  const m = /(\d+[.,]?\d*)\s*(кг|г|мл|л|шт)(?!\p{L})/iu.exec(name)
  if (!m) return null
  const size = Number(m[1].replace(',', '.'))
  const unit = m[2].toLowerCase() as Unit
  if (!Number.isFinite(size) || size <= 0) return null
  return { size, unit }
}

export function inferPantryFromReceipts(
  receipts: ReceiptForImport[],
  now: Date = new Date(),
): ReceiptImportResult {
  const decisions: ReceiptImportDecision[] = []
  // ключ → позиція; кілька чеків з тим самим продуктом зливаються в одну
  const merged = new Map<string, InferredPantryItem>()

  const sorted = [...receipts].sort((a, b) => a.date.localeCompare(b.date))

  for (const receipt of sorted) {
    const purchaseDate = new Date(receipt.date)
    if (Number.isNaN(purchaseDate.getTime())) continue
    const daysSince = -daysUntil(purchaseDate, now)

    for (const line of receipt.items) {
      const lower = line.name.toLowerCase()
      if (NON_FOOD.some((w) => lower.includes(w))) {
        decisions.push({
          productName: line.name,
          normalizedName: '',
          decision: 'skipped_non_food',
          reason: 'Не є продуктом харчування',
        })
        continue
      }

      const normalizedName = normalizeProductName(line.name)
      if (!normalizedName) continue
      const guess = guessCategory(normalizedName)
      const expiryDate = addDays(purchaseDate, guess.shelfLifeDays)

      if (daysUntil(expiryDate, now) < 0) {
        decisions.push({
          productName: line.name,
          normalizedName,
          decision: 'skipped_expired',
          reason: `Куплено ${daysSince} дн. тому, типовий термін ${guess.shelfLifeDays} дн. — імовірно, вже непридатне`,
        })
        continue
      }

      const pack = parsePackFromName(line.name) ?? DEFAULT_PACK[normalizedName] ?? { size: 1, unit: 'шт' as Unit }
      const fraction = remainingFraction(daysSince, guess.shelfLifeDays)
      const quantity = round2(pack.size * line.quantity * fraction)

      if (quantity <= 0) {
        decisions.push({
          productName: line.name,
          normalizedName,
          decision: 'skipped_expired',
          reason: `За ${daysSince} дн. цей продукт зазвичай уже спожито`,
        })
        continue
      }

      const existing = merged.get(normalizedName)
      if (existing && existing.unit === pack.unit) {
        existing.quantity = round2(existing.quantity + quantity)
        // беремо найпізніший термін придатності з наявних покупок
        if (expiryDate > (existing.expiryDate ?? new Date(0))) existing.expiryDate = expiryDate
        existing.confidence = Math.max(existing.confidence, inferenceConfidence(daysSince, guess.shelfLifeDays))
        decisions.push({
          productName: line.name,
          normalizedName,
          decision: 'merged',
          reason: 'Обʼєднано з позицією з іншого чека',
        })
        continue
      }

      merged.set(normalizedName, {
        normalizedName,
        originalName: line.name,
        category: guess.category,
        storageLocation: guess.storageLocation,
        quantity,
        unit: pack.unit,
        expiryDate,
        confidence: inferenceConfidence(daysSince, guess.shelfLifeDays),
        needsConfirmation: true,
        source: receipt.kind === 'online_order' ? 'online_order' : 'offline_receipt',
        productId: line.productId,
        provenance:
          receipt.kind === 'online_order'
            ? `Онлайн-замовлення від ${formatDate(purchaseDate)}`
            : `Чек «Сільпо» від ${formatDate(purchaseDate)}`,
      })
      decisions.push({
        productName: line.name,
        normalizedName,
        decision: 'imported',
        reason: `Залишок оцінено як ${Math.round(fraction * 100)}% упаковки через ${daysSince} дн. після покупки`,
      })
    }
  }

  return { items: [...merged.values()], decisions }
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 59, 0)
  return d
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
