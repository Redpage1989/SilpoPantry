import type {
  CoverageResult,
  MissingIngredient,
  PantryEntry,
  RecipeIngredient,
  RecipeLike,
  Kopiyky,
} from './types'
import { areUnitsCompatible, toBase, convert } from './units'
import { daysUntil, SOON_DAYS } from './pantry'

/** Орієнтовна ціна одиниці, коли рецепт її не задав (копійки за г/мл/шт). */
const FALLBACK_PRICE_PER_BASE_UNIT: Record<string, Kopiyky> = {
  'яйця': 700, // за штуку
  'молоко': 5, // за мл
  'вершки': 12,
  'маскарпоне': 60,
  'масло вершкове': 40,
  'сир твердий': 45,
  'савоярді': 50,
  'кава': 60,
  'какао': 55,
  'цукор': 4,
  'борошно': 3,
  'макарони': 8,
  'помідори': 9,
  'шпинат': 30,
  'куряче філе': 25,
}

const DEFAULT_PRICE_PER_BASE_UNIT: Kopiyky = 15

function approxCostFor(ing: RecipeIngredient, missingQty: number): Kopiyky {
  if (ing.approxPricePerUnit) return Math.round(ing.approxPricePerUnit * missingQty)
  const perBase = FALLBACK_PRICE_PER_BASE_UNIT[ing.normalizedName] ?? DEFAULT_PRICE_PER_BASE_UNIT
  const base = toBase(missingQty, ing.unit)
  return Math.round(perBase * base)
}

/**
 * Головна функція матчингу: що з рецепта вже є вдома, а чого не вистачає.
 *
 * Правила, які тут закодовані:
 *  · необовʼязкові інгредієнти не впливають на coverage і не блокують готування;
 *  · заміна з комори закриває потребу, але це показується користувачу явно;
 *  · часткова нестача («треба 200 г, є 120 г») — окремий стан `insufficient`,
 *    бо докупити 80 г ≠ докупити 200 г, і це прямо впливає на суму кошика;
 *  · несумісні одиниці не змішуються (див. units.convert).
 */
export function calculateMissingIngredients(
  recipe: RecipeLike,
  pantry: PantryEntry[],
  options: { servings?: number; now?: Date } = {},
): CoverageResult {
  const now = options.now ?? new Date()
  const multiplier = options.servings ? options.servings / recipe.servings : 1

  const have: RecipeIngredient[] = []
  const missing: MissingIngredient[] = []
  const rescues = new Set<string>()

  // локальний облік, щоб один продукт не «закрив» два різні інгредієнти
  const remaining = new Map<string, number>()
  for (const item of pantry) {
    remaining.set(item.id, item.quantity)
  }

  let requiredCount = 0
  let coveredScore = 0

  for (const raw of recipe.ingredients) {
    const ing: RecipeIngredient = { ...raw, quantity: raw.quantity * multiplier }
    const isRequired = !ing.optional
    if (isRequired) requiredCount += 1

    const substituteKeys = (ing.substitutes ?? []).map((s) => s.toLowerCase())
    const candidates = pantry
      .filter(
        (p) =>
          (p.normalizedName === ing.normalizedName || substituteKeys.includes(p.normalizedName)) &&
          areUnitsCompatible(p.unit, ing.unit) &&
          (remaining.get(p.id) ?? 0) > 0,
      )
      .sort((a, b) => {
        // спершу прямий збіг, потім найближчий термін придатності
        const directA = a.normalizedName === ing.normalizedName ? 0 : 1
        const directB = b.normalizedName === ing.normalizedName ? 0 : 1
        if (directA !== directB) return directA - directB
        const da = a.expiryDate ? daysUntil(a.expiryDate, now) : 9999
        const db = b.expiryDate ? daysUntil(b.expiryDate, now) : 9999
        return da - db
      })

    let neededBase = toBase(ing.quantity, ing.unit)
    let usedSubstitute: MissingIngredient['coveredBySubstitute']

    for (const item of candidates) {
      if (neededBase <= 0.0001) break
      const availableBase = toBase(remaining.get(item.id)!, item.unit)
      const take = Math.min(neededBase, availableBase)
      if (take <= 0) continue
      const takeInItemUnit = convert(take, baseUnitOf(item.unit), item.unit)
      remaining.set(item.id, remaining.get(item.id)! - takeInItemUnit)
      neededBase -= take
      if (item.normalizedName !== ing.normalizedName) {
        usedSubstitute = { normalizedName: item.normalizedName, originalName: item.originalName }
      }
      if (item.expiryDate && daysUntil(item.expiryDate, now) <= SOON_DAYS) {
        rescues.add(item.normalizedName)
      }
    }

    const neededTotalBase = toBase(ing.quantity, ing.unit)
    const usedBase = neededTotalBase - Math.max(0, neededBase)
    const fraction = neededTotalBase === 0 ? 1 : usedBase / neededTotalBase

    if (neededBase <= 0.0001) {
      have.push(ing)
      if (isRequired) coveredScore += 1
    } else {
      if (isRequired) coveredScore += fraction
      const missingQty = round2(convert(neededBase, baseUnitOf(ing.unit), ing.unit))
      missing.push({
        name: ing.name,
        normalizedName: ing.normalizedName,
        needed: round2(ing.quantity),
        have: round2(ing.quantity - missingQty),
        missing: missingQty,
        unit: ing.unit,
        kind: usedBase > 0.0001 ? 'insufficient' : 'absent',
        optional: !!ing.optional,
        coveredBySubstitute: usedSubstitute,
        approxCost: approxCostFor(ing, missingQty),
      })
    }
  }

  const coverage = requiredCount === 0 ? 1 : clamp01(coveredScore / requiredCount)
  const approxMissingCost = missing
    .filter((m) => !m.optional)
    .reduce((sum, m) => sum + m.approxCost, 0)

  return { coverage, have, missing, rescues: [...rescues], approxMissingCost }
}

function baseUnitOf(unit: string): 'г' | 'мл' | 'шт' {
  if (unit === 'шт') return 'шт'
  if (unit === 'г' || unit === 'кг' || unit === 'пуч') return 'г'
  return 'мл'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
