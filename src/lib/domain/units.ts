import type { Unit } from './types'

/**
 * Конвертація одиниць. Три несумісні виміри: маса, обʼєм, штуки.
 * Ложки/пучки — кулінарні наближення, вони навмисно приблизні,
 * бо в рецептах точність «1 ст.л = 15 мл» цілком достатня.
 */

type Dimension = 'mass' | 'volume' | 'count'

const TO_BASE: Record<Unit, { dim: Dimension; factor: number }> = {
  'г': { dim: 'mass', factor: 1 },
  'кг': { dim: 'mass', factor: 1000 },
  'мл': { dim: 'volume', factor: 1 },
  'л': { dim: 'volume', factor: 1000 },
  'шт': { dim: 'count', factor: 1 },
  'ст.л': { dim: 'volume', factor: 15 },
  'ч.л': { dim: 'volume', factor: 5 },
  'пуч': { dim: 'mass', factor: 40 },
}

export function dimensionOf(unit: Unit): Dimension {
  return TO_BASE[unit].dim
}

export function areUnitsCompatible(a: Unit, b: Unit): boolean {
  return dimensionOf(a) === dimensionOf(b)
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
