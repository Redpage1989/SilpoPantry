import type { RecipeLike, Restriction, ProductOption } from './types'
import { normalizeProductName } from './normalize'

/**
 * Перевірка страв і товарів на харчові обмеження родини.
 *
 * Свідома межа прототипу: ми НЕ даємо медичних гарантій.
 * Для алергій завжди повертаємо блокування + вимогу перевірити склад
 * на упаковці, навіть якщо в наших даних алергену немає.
 */

/** Що вважається носієм алергену. Ключі — нормалізовані назви алергенів. */
const ALLERGEN_SOURCES: Record<string, string[]> = {
  'лактоза': ['молоко', 'вершки', 'сметана', 'маскарпоне', 'масло вершкове', 'сир', 'сир твердий', 'сир кисломолочний', 'йогурт', 'кефір'],
  'молочний білок': ['молоко', 'вершки', 'сметана', 'маскарпоне', 'масло вершкове', 'сир', 'сир твердий', 'сир кисломолочний', 'йогурт'],
  'глютен': ['борошно', 'макарони', 'хліб', 'савоярді', 'печиво', 'булгур', 'манка'],
  'яйця': ['яйця', 'майонез', 'савоярді'],
  'арахіс': ['арахіс', 'арахісова паста'],
  'горіхи': ['горіхи', 'мигдаль', 'фундук', 'волоські горіхи', 'кешʼю'],
  'риба': ['риба', 'лосось', 'тунець', 'оселедець'],
  'морепродукти': ['креветки', 'мідії', 'кальмари'],
  'соя': ['соєвий соус', 'тофу', 'соя'],
  'мед': ['мед'],
}

/** Дієти → інгредієнти, що їх порушують. */
const DIET_FORBIDS: Record<string, string[]> = {
  'vegetarian': ['куряче філе', 'фарш', 'свинина', 'яловичина', 'риба', 'лосось', 'ковбаса', 'бекон', 'желатин'],
  'vegan': ['куряче філе', 'фарш', 'свинина', 'яловичина', 'риба', 'лосось', 'ковбаса', 'бекон', 'желатин', 'молоко', 'вершки', 'сметана', 'маскарпоне', 'масло вершкове', 'сир', 'яйця', 'мед'],
  'pescatarian': ['куряче філе', 'фарш', 'свинина', 'яловичина', 'ковбаса', 'бекон'],
  'halal': ['свинина', 'бекон', 'сало'],
  'kosher': ['свинина', 'бекон', 'сало', 'креветки', 'мідії'],
  'gluten-free': DIET_FORBIDS_GLUTEN(),
  'lactose-free': ['молоко', 'вершки', 'сметана', 'маскарпоне', 'сир', 'йогурт', 'кефір'],
}

function DIET_FORBIDS_GLUTEN(): string[] {
  return ['борошно', 'макарони', 'хліб', 'савоярді', 'печиво', 'манка', 'булгур']
}

/** Теги, що позначають характеристики страви (для «дитина не любить гостре»). */
const DISLIKE_TAGS: Record<string, string[]> = {
  'гостре': ['spicy'],
  'spicy': ['spicy'],
  'кисле': ['sour'],
  'гриби': ['mushrooms'],
}

export type RestrictionSeverityResult = 'blocked' | 'warning' | 'ok'

export interface RestrictionCheck {
  result: RestrictionSeverityResult
  /** 1 — повна відповідність, 0 — страва заборонена */
  score: number
  violations: {
    restriction: Restriction
    /** через який інгредієнт спрацювало */
    trigger: string
    level: 'blocked' | 'warning'
    message: string
  }[]
  /** додаткове повідомлення для алергій: перевірити склад на упаковці */
  allergyNotice: string | null
}

/** Перевіряє страву проти всіх обмежень родини. */
export function checkRecipeAgainstRestrictions(
  recipe: RecipeLike,
  restrictions: Restriction[],
): RestrictionCheck {
  const ingredientKeys = recipe.ingredients.map((i) => i.normalizedName || normalizeProductName(i.name))
  const tags = recipe.tags.map((t) => t.toLowerCase())
  const violations: RestrictionCheck['violations'] = []

  for (const r of restrictions) {
    const value = r.value.toLowerCase().trim()
    const who = r.memberName ? ` (${r.memberName})` : ''

    if (r.restrictionType === 'allergy' || r.restrictionType === 'intolerance') {
      const sources = ALLERGEN_SOURCES[value] ?? [value]
      const trigger = ingredientKeys.find((k) => sources.includes(k))
      if (trigger) {
        violations.push({
          restriction: r,
          trigger,
          level: 'blocked',
          message:
            r.restrictionType === 'allergy'
              ? `Містить «${trigger}» — алерген${who}: ${r.value}`
              : `Містить «${trigger}» — непереносимість${who}: ${r.value}`,
        })
      }
      continue
    }

    if (r.restrictionType === 'diet' || r.restrictionType === 'religious') {
      const forbidden = DIET_FORBIDS[value] ?? [value]
      const trigger = ingredientKeys.find((k) => forbidden.includes(k))
      if (trigger) {
        violations.push({
          restriction: r,
          trigger,
          level: r.severity === 'critical' || r.severity === 'high' ? 'blocked' : 'warning',
          message: `Не відповідає обмеженню${who} «${r.value}»: ${trigger}`,
        })
      }
      continue
    }

    if (r.restrictionType === 'dislike') {
      const tagHits = DISLIKE_TAGS[value] ?? []
      const byTag = tags.find((t) => tagHits.includes(t))
      const byIngredient = ingredientKeys.find((k) => k === normalizeProductName(value))
      const trigger = byTag ?? byIngredient
      if (trigger) {
        violations.push({
          restriction: r,
          trigger,
          level: 'warning',
          message: `Може не сподобатись${who}: ${r.value}`,
        })
      }
    }
  }

  const blocked = violations.some((v) => v.level === 'blocked')
  const warnings = violations.filter((v) => v.level === 'warning').length

  const hasAllergy = restrictions.some((r) => r.restrictionType === 'allergy')
  return {
    result: blocked ? 'blocked' : warnings > 0 ? 'warning' : 'ok',
    // блокування = 0, щоб множник у scoring відсіяв страву повністю
    score: blocked ? 0 : Math.max(0, 1 - warnings * 0.25),
    violations,
    allergyNotice: hasAllergy
      ? 'У родині є алергія. Обовʼязково перевіряйте склад на упаковці — застосунок не дає медичних гарантій.'
      : null,
  }
}

/**
 * Перевірка конкретного товару «Сільпо» перед додаванням у кошик.
 * Якщо MCP повернув склад — використовуємо його; якщо ні — кажемо про це чесно.
 */
export function checkProductAgainstRestrictions(
  product: ProductOption,
  restrictions: Restriction[],
): { safe: boolean; unknownComposition: boolean; messages: string[] } {
  const messages: string[] = []
  const nameKey = normalizeProductName(product.name)
  const declared = (product.allergens ?? []).map((a) => a.toLowerCase())
  const unknownComposition = product.allergens === undefined

  let safe = true
  for (const r of restrictions) {
    if (r.restrictionType !== 'allergy' && r.restrictionType !== 'intolerance') continue
    const value = r.value.toLowerCase()
    const sources = ALLERGEN_SOURCES[value] ?? [value]
    if (declared.includes(value) || sources.includes(nameKey)) {
      safe = false
      messages.push(`«${product.name}» може містити ${r.value}${r.memberName ? ` — ${r.memberName}` : ''}`)
    }
  }

  if (unknownComposition && restrictions.some((r) => r.restrictionType === 'allergy')) {
    messages.push('Склад товару недоступний через MCP — перевірте упаковку особисто.')
  }

  return { safe, unknownComposition, messages }
}
