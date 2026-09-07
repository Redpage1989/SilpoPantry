import type { Unit } from './types'

/**
 * Конвертація одиниць. Три несумісні виміри: маса, обʼєм, штуки.
 * Ложки/пучки — кулінарні наближення, вони навмисно приблизні,
 * бо в рецептах точність «1 ст.л = 15 мл» цілком достатня.
 */

type Dimension = 'mass' | 'volume' | 'count' | 'pack'

const TO_BASE: Record<Unit, { dim: Dimension; factor: number }> = {
  'г': { dim: 'mass', factor: 1 },
  'кг': { dim: 'mass', factor: 1000 },
  'мл': { dim: 'volume', factor: 1 },
  'л': { dim: 'volume', factor: 1000 },
  'шт': { dim: 'count', factor: 1 },
  'ст.л': { dim: 'volume', factor: 15 },
  'ч.л': { dim: 'volume', factor: 5 },
  'пуч': { dim: 'mass', factor: 40 },
  // «упаковка» — окремий вимір: розмір невідомий, тож ні з чим не конвертується
  'уп': { dim: 'pack', factor: 1 },
}

export function dimensionOf(unit: Unit): Dimension {
  return TO_BASE[unit].dim
}

export function areUnitsCompatible(a: Unit, b: Unit): boolean {
  return dimensionOf(a) === dimensionOf(b)
}

/** Базова одиниця виміру, до якого належить `unit`. */
export function baseUnitOf(unit: Unit): 'г' | 'мл' | 'шт' | 'уп' {
  const dim = dimensionOf(unit)
  return dim === 'mass' ? 'г' : dim === 'volume' ? 'мл' : dim === 'count' ? 'шт' : 'уп'
}

/**
 * Скільки важить одна штука. Міст між рецептом і коморою: рецепт міряє
 * цибулю штуками, а «Сільпо» віддає її вагою (ваговий товар приходить із
 * каталогу в грамах), і рука у формі «додати вручну» теж частіше пише «1 кг».
 *
 * Доти виміри просто не змішувались, і півкілограма цибулі вдома читалось як
 * «цибулі немає» — з пропозицією докупити ще одну. Те саме било по моркві,
 * картоплі й помідорах, тобто по половині овочевих рецептів, і однаково в
 * двох місцях: у підрахунку нестачі та у списанні після «Я це приготував».
 *
 * Числа — середня товарна одиниця, не точна вага. Міст працює в обидва боки
 * й лише для цих продуктів: там, де штука нічого не важить (упаковка), його
 * немає й бути не може.
 *
 * ponytail: одна середня вага на продукт; калібрувати поштучно, якщо
 * зʼявиться вага з етикетки.
 */
export const PIECE_GRAMS: Record<string, number> = {
  'цибуля': 100,
  'зелена цибуля': 40,
  'часник': 5, // зубчик — рецепти рахують саме їх
  'помідори': 120,
  'огірки': 100,
  'перець': 150,
  'лимон': 100,
  'авокадо': 200,
  'банани': 120,
  'яблука': 180,
  'груші': 180,
  'апельсини': 200,
  'яйця': 60,
  'картопля': 120,
  'морква': 90,
  'буряк': 200,
  'кабачки': 300,
  'баклажани': 250,
  'капуста': 1500,
  'гарбуз': 2000,
  'хліб': 30, // скибка: рецепти беруть хліб для грінок і сирників
}

/**
 * Пара конвертерів у базову одиницю інгредієнта `target`, з мостом
 * «штука ↔ вага» для рахованих продуктів.
 *
 * Живе тут, а не в матчингу, бо потрібна двом місцям одразу: підрахунку
 * нестачі та списанню з комори. Розійшовшись, вони показували б «є вдома»
 * на екрані рецепта й «не вистачило» одразу після приготування.
 */
export function unitBridge(normalizedName: string, target: Unit) {
  const grams = PIECE_GRAMS[normalizedName]
  const base = baseUnitOf(target)
  return {
    /** Кількість у базовій одиниці інгредієнта; null — звести неможливо. */
    toBase(quantity: number, unit: Unit): number | null {
      if (areUnitsCompatible(unit, target)) return toBase(quantity, unit)
      if (!grams) return null
      if (base === 'шт' && dimensionOf(unit) === 'mass') return toBase(quantity, unit) / grams
      if (base === 'г' && unit === 'шт') return quantity * grams
      return null
    },
    /** Зворотний бік: базова кількість інгредієнта → одиниця рядка комори. */
    fromBase(baseQuantity: number, unit: Unit): number {
      if (areUnitsCompatible(unit, target)) return convert(baseQuantity, base as Unit, unit)
      return base === 'шт' ? convert(baseQuantity * grams!, 'г', unit) : baseQuantity / grams!
    },
  }
}

/** Переводить значення у базову одиницю виміру (г / мл / шт). */
export function toBase(quantity: number, unit: Unit): number {
  return quantity * TO_BASE[unit].factor
}

/** Переводить базове значення у вказану одиницю. */
export function fromBase(baseQuantity: number, unit: Unit): number {
  return baseQuantity / TO_BASE[unit].factor
}

/**
 * Конвертує кількість між одиницями. Кидає, якщо виміри несумісні —
 * мовчазна конвертація «200 г → 200 мл» призвела б до неправильних
 * підрахунків нестачі, а це прямо псує кошик користувача.
 */
export function convert(quantity: number, from: Unit, to: Unit): number {
  if (from === to) return quantity
  if (!areUnitsCompatible(from, to)) {
    throw new Error(`Несумісні одиниці: ${from} → ${to}`)
  }
  return fromBase(toBase(quantity, from), to)
}

/** Безпечна конвертація: null замість помилки. */
export function tryConvert(quantity: number, from: Unit, to: Unit): number | null {
  try {
    return convert(quantity, from, to)
  } catch {
    return null
  }
}

/** Людяне форматування кількості: 0.5 л, 250 г, 3 шт. */
export function formatQuantity(quantity: number, unit: Unit): string {
  const rounded = Math.round(quantity * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
  return `${text} ${unit}`
}

/** Приводить кількість до зручнішої одиниці: 1500 г → 1,5 кг. */
export function humanize(quantity: number, unit: Unit): { quantity: number; unit: Unit } {
  if (unit === 'г' && quantity >= 1000) return { quantity: quantity / 1000, unit: 'кг' }
  if (unit === 'мл' && quantity >= 1000) return { quantity: quantity / 1000, unit: 'л' }
  if (unit === 'кг' && quantity < 1) return { quantity: quantity * 1000, unit: 'г' }
  if (unit === 'л' && quantity < 1) return { quantity: quantity * 1000, unit: 'мл' }
  return { quantity, unit }
}
