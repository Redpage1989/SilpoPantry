import type { PantryEntry, Unit, RecipeIngredient } from './types'
import { convert, tryConvert, areUnitsCompatible, toBase } from './units'
import { normalizeProductName } from './normalize'

/** Скільки днів до псування вважаємо «терміново». */
export const URGENT_DAYS = 1
export const SOON_DAYS = 3

export type ExpiryStatus = 'expired' | 'use_today' | 'expiring_soon' | 'fresh' | 'unknown'

export const EXPIRY_LABELS: Record<ExpiryStatus, string> = {
  expired: 'Термін минув',
  use_today: 'Використати сьогодні',
  expiring_soon: 'Скоро закінчиться',
  fresh: 'Свіже',
  unknown: 'Термін невідомий',
}

/** Кількість повних днів між датами (у локальному дні, без урахування годин). */
export function daysUntil(date: Date, now: Date): number {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((a - b) / 86_400_000)
}

export function expiryStatus(expiryDate: Date | null, now: Date): ExpiryStatus {
  if (!expiryDate) return 'unknown'
  const d = daysUntil(expiryDate, now)
  if (d < 0) return 'expired'
  if (d <= URGENT_DAYS) return 'use_today'
  if (d <= SOON_DAYS) return 'expiring_soon'
  return 'fresh'
}

/** Продукти, які треба використати найближчим часом, у порядку терміновості. */
export function findExpiringProducts(items: PantryEntry[], now: Date, limit = 5): PantryEntry[] {
  return items
    .filter((i) => i.expiryDate !== null && daysUntil(i.expiryDate, now) <= SOON_DAYS)
    .sort((a, b) => daysUntil(a.expiryDate!, now) - daysUntil(b.expiryDate!, now))
    .slice(0, limit)
}

/**
 * Сумарний запас одного інгредієнта в коморі.
 * Позиції в різних одиницях одного виміру складаються;
 * несумісні (200 г сиру + 1 шт сиру) НЕ складаються — повертаємо
 * ту групу, що збігається за виміром із запитаною одиницею.
 */
export function totalAvailable(items: PantryEntry[], normalizedName: string, unit: Unit): number {
  return items
    .filter((i) => i.normalizedName === normalizedName && !isConsumed(i))
    .reduce((sum, i) => {
      const converted = tryConvert(i.quantity, i.unit, unit)
      return converted === null ? sum : sum + converted
    }, 0)
}

function isConsumed(item: PantryEntry): boolean {
  return item.quantity <= 0
}

/**
 * Знаходить позиції комори, що покривають інгредієнт —
 * прямим збігом або через дозволену заміну.
 */
export function findPantryMatches(
  items: PantryEntry[],
  ingredient: RecipeIngredient,
): { direct: PantryEntry[]; substitutes: PantryEntry[] } {
  const key = ingredient.normalizedName || normalizeProductName(ingredient.name)
  const subs = (ingredient.substitutes ?? []).map(normalizeProductName)
  const direct = items.filter((i) => i.normalizedName === key && !isConsumed(i))
  const substitutes = items.filter((i) => subs.includes(i.normalizedName) && !isConsumed(i))
  return { direct, substitutes }
}

export interface DeductionPlan {
  itemId: string
  originalName: string
  /** скільки списуємо в одиницях самої позиції */
  deducted: number
  unit: Unit
  remaining: number
  /** позицію треба видалити з комори (залишок 0) */
  removed: boolean
}

export interface DeductionResult {
  plan: DeductionPlan[]
  /** інгредієнти, яких не вистачило навіть після списання всього наявного */
  shortfall: { normalizedName: string; missing: number; unit: Unit }[]
}

/**
 * Списання інгредієнтів після «Я це приготував».
 * Списуємо FIFO за терміном придатності: спочатку те, що псується раніше —
 * це і є механізм зменшення харчових відходів.
 * Чиста функція: нічого не мутує, повертає план для застосування в БД.
 */
export function planDeduction(
  items: PantryEntry[],
  ingredients: RecipeIngredient[],
  servingsMultiplier = 1,
  now: Date = new Date(),
): DeductionResult {
  const plan: DeductionPlan[] = []
  const shortfall: DeductionResult['shortfall'] = []
  // локальні залишки, щоб два інгредієнти не списали один і той самий продукт двічі
  const remaining = new Map(items.map((i) => [i.id, i.quantity]))

  for (const ing of ingredients) {
    if (ing.optional) continue
    let needBase = toBase(ing.quantity * servingsMultiplier, ing.unit)
    const { direct, substitutes } = findPantryMatches(items, ing)
    const candidates = [...direct, ...substitutes]
      .filter((i) => areUnitsCompatible(i.unit, ing.unit))
      .sort(byExpiryThenOldest(now))

    for (const item of candidates) {
      if (needBase <= 0.0001) break
      const availableInItem = remaining.get(item.id) ?? 0
      if (availableInItem <= 0) continue
      const availableBase = toBase(availableInItem, item.unit)
      const takeBase = Math.min(needBase, availableBase)
      const takeInItemUnit = convert(takeBase, baseUnitFor(item.unit), item.unit)
      const left = round3(availableInItem - takeInItemUnit)
      remaining.set(item.id, left)
      plan.push({
        itemId: item.id,
        originalName: item.originalName,
        deducted: round3(takeInItemUnit),
        unit: item.unit,
        remaining: left,
        removed: left <= 0.0001,
      })
      needBase -= takeBase
    }

    if (needBase > 0.0001) {
      shortfall.push({
        normalizedName: ing.normalizedName,
        missing: round3(convert(needBase, baseUnitFor(ing.unit), ing.unit)),
        unit: ing.unit,
      })
    }
  }

  return { plan, shortfall }
}

function baseUnitFor(unit: Unit): Unit {
  const dim = unit === 'шт' ? 'count' : unit === 'г' || unit === 'кг' || unit === 'пуч' ? 'mass' : 'volume'
  return dim === 'mass' ? 'г' : dim === 'volume' ? 'мл' : 'шт'
}

function byExpiryThenOldest(now: Date) {
  return (a: PantryEntry, b: PantryEntry): number => {
    const da = a.expiryDate ? daysUntil(a.expiryDate, now) : 9999
    const db = b.expiryDate ? daysUntil(b.expiryDate, now) : 9999
    if (da !== db) return da - db
    return a.originalName.localeCompare(b.originalName, 'uk')
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Груба оцінка «на скільки днів вистачить продуктів».
 * Рахуємо не калорії (для фото це псевдоточність), а кількість
 * «повноцінних порцій основи»: білок + гарнір + овоч.
 */
export function estimateDaysOfFood(items: PantryEntry[], peopleCount: number, mealsPerDay: number): number {
  const groups = {
    protein: ['яйця', 'куряче філе', 'фарш', 'риба', 'лосось', 'сир', 'сир кисломолочний', 'маскарпоне'],
    carb: ['макарони', 'рис', 'гречка', 'картопля', 'хліб', 'борошно'],
    veg: ['помідори', 'огірки', 'шпинат', 'цибуля', 'морква', 'салат', 'перець'],
  }
  const servingBase = { protein: 150, carb: 100, veg: 120 }
  const counts = (Object.keys(groups) as (keyof typeof groups)[]).map((g) => {
    const grams = items
      .filter((i) => groups[g].includes(i.normalizedName))
      .reduce((sum, i) => {
        if (i.unit === 'шт') return sum + i.quantity * 60 // умовна вага штуки
        const asGrams = tryConvert(i.quantity, i.unit, 'г')
        return sum + (asGrams ?? 0)
      }, 0)
    return grams / servingBase[g]
  })
  const servings = Math.min(...counts)
  const perDay = Math.max(1, peopleCount * Math.max(1, mealsPerDay - 1))
  return Math.max(0, Math.round((servings / perDay) * 10) / 10)
}

/**
 * Базові продукти, відсутність яких варто помітити.
 *
 * Перелік свідомо один на весь застосунок: він живив і список «докупити» на
 * головній, і показник на екрані комори, і два окремі масиви розійшлися б
 * при першій же правці.
 */
export const STAPLES = ['молоко', 'яйця', 'хліб', 'олія', 'цукор', 'борошно', 'масло вершкове'] as const

/**
 * Рівень упевненості словами.
 *
 * «впевненість 65%» — це наша внутрішня метрика, а не поняття, яким людина
 * оперує біля холодильника. Число нічого не підказує: 65% — це багато чи
 * мало, і що з цим робити? Формулювання називає дію, а не шкалу.
 */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return 'точно'
  if (confidence >= 0.6) return 'приблизно'
  return 'варто перевірити'
}

/**
 * Тон бейджа впевненості — ті САМІ пороги, що й у confidenceLabel.
 *
 * Коли пороги жили окремо (0.8/0.5 у комори, 0.85/0.6 в сканера), confidence
 * 0.82 давав зелений бейдж зі словом «приблизно», а той самий товар на /scan
 * був жовтим. Слова виказали розбіжність, яку відсотки ховали.
 */
export function confidenceTone(confidence: number): 'success' | 'warn' | 'danger' {
  if (confidence >= 0.85) return 'success'
  if (confidence >= 0.6) return 'warn'
  return 'danger'
}

/** Джерела, які означають «продукт щойно з'явився вдома», а не «я його бачу». */
const PURCHASE_SOURCES = ['online_order', 'offline_receipt', 'previous_cart', 'manual']

export interface PantryRowLike {
  id: string
  quantity: number
  unit: Unit
  expiryDate: Date | null
}

export interface IncomingPantryItem {
  quantity: number
  unit: Unit
  expiryDate: Date | null
  source: string
}

export type PantryWritePlan =
  | { action: 'create' }
  | { action: 'merge'; id: string; quantity: number; unit: Unit; expiryDate: Date | null }

/**
 * Куди записати підтверджену позицію: у новий рядок чи в наявний.
 *
 * Без цього комора роздвоювалась. Чеки дають «Молоко 2,5%» 0,7 л, фото
 * холодильника дає «Молоко» 700 мл — обидва нормалізуються в `молоко`, але
 * створювались двома рядками. Далі це протікало в тексти: пояснення страви
 * перелічувало рядки, а не продукти, і виходило «використовує Шпинат і
 * Шпинат і Шпинат і Шпинат свіжий».
 *
 * Правило залежить від джерела, бо це різні твердження про світ:
 *
 * - фото — це спостереження ПОТОЧНОГО запасу, тож кількість замінюється.
 *   Скласти означало б подвоїти те саме молоко, яке видно на полиці;
 * - покупка (чек, замовлення, ручне додавання) — це поповнення, тож
 *   кількість додається.
 *
 * Несумісні одиниці (200 г сиру проти 1 шт) не зливаються: приховане
 * «г = шт» зіпсувало б підрахунок нестачі й кошик. Такий випадок лишається
 * окремим рядком — це чесніше, ніж вигадане число.
 */
export function planPantryWrite(existing: PantryRowLike | null, incoming: IncomingPantryItem): PantryWritePlan {
  if (!existing) return { action: 'create' }
  const converted = tryConvert(incoming.quantity, incoming.unit, existing.unit)
  if (converted === null) return { action: 'create' }

  const quantity = PURCHASE_SOURCES.includes(incoming.source)
    ? Math.round((existing.quantity + converted) * 100) / 100
    : Math.round(converted * 100) / 100

  /**
   * Термін придатності: пізніший із двох, але невідомий не стирає відомий.
   * Фото рідко показує дату на упаковці, і без цієї межі один скан
   * перетворював «використати до завтра» на «термін невідомий» — тобто
   * гасив саме той сигнал, заради якого комора й ведеться.
   */
  const expiryDate =
    incoming.expiryDate === null
      ? existing.expiryDate
      : existing.expiryDate === null || incoming.expiryDate > existing.expiryDate
        ? incoming.expiryDate
        : existing.expiryDate

  return { action: 'merge', id: existing.id, quantity, unit: existing.unit, expiryDate }
}
