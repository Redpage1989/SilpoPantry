import type { CoverageResult, HouseholdContext, PantryEntry, RecipeLike, Kopiyky } from './types'
import { calculateMissingIngredients } from './matching'
import { checkRecipeAgainstRestrictions, type RestrictionCheck } from './restrictions'
import { daysUntil, SOON_DAYS, URGENT_DAYS } from './pantry'
import { displayName } from './normalize'

/**
 * Прозорий скоринг рецептів. Ваги зафіксовані в ТЗ і винесені сюди,
 * щоб їх можна було показати користувачу і журі, а не ховати в коді.
 */
export const WEIGHTS = {
  pantryCoverage: 0.3,
  expiryRescue: 0.25,
  restrictionMatch: 0.2,
  budgetMatch: 0.1,
  timeMatch: 0.1,
  preferenceMatch: 0.05,
} as const

export interface ScoreFactor {
  key: keyof typeof WEIGHTS
  label: string
  value: number
  weight: number
  contribution: number
  explanation: string
}

export interface ScoredRecipe {
  recipe: RecipeLike
  score: number
  factors: ScoreFactor[]
  coverage: CoverageResult
  restrictions: RestrictionCheck
  /** головне пояснення однією фразою для картки */
  reason: string
  /** страва заборонена обмеженнями і не показується в основному списку */
  blocked: boolean
  missingCost: Kopiyky
}

export interface ScoringRequest {
  pantry: PantryEntry[]
  household: HouseholdContext
  servings?: number
  maxMinutes?: number
  maxBudget?: Kopiyky | null
  /** режим «використати те, що скоро зіпсується» піднімає вагу порятунку */
  rescueMode?: boolean
  now?: Date
}

export function scoreRecipe(recipe: RecipeLike, req: ScoringRequest): ScoredRecipe {
  const now = req.now ?? new Date()
  const servings = req.servings ?? recipe.servings
  const coverage = calculateMissingIngredients(recipe, req.pantry, { servings, now })
  const restrictions = checkRecipeAgainstRestrictions(recipe, req.household.restrictions)

  const expiry = expiryRescueScore(recipe, req.pantry, coverage, now)
  const budget = budgetMatchScore(coverage.approxMissingCost, req.maxBudget ?? null)
  const time = timeMatchScore(recipe.cookingTime, req.maxMinutes ?? req.household.maxCookMinutes)
  const preference = preferenceMatchScore(recipe, req.household)

  const weights = req.rescueMode
    ? { ...WEIGHTS, expiryRescue: 0.4, pantryCoverage: 0.25, budgetMatch: 0.05, timeMatch: 0.05 }
    : WEIGHTS

  const factors: ScoreFactor[] = [
    {
      key: 'pantryCoverage',
      label: 'Є вдома',
      value: coverage.coverage,
      weight: weights.pantryCoverage,
      contribution: coverage.coverage * weights.pantryCoverage,
      explanation: coverageExplanation(coverage),
    },
    {
      key: 'expiryRescue',
      label: 'Рятує продукти',
      value: expiry.value,
      weight: weights.expiryRescue,
      contribution: expiry.value * weights.expiryRescue,
      explanation: expiry.explanation,
    },
    {
      key: 'restrictionMatch',
      label: 'Обмеження родини',
      value: restrictions.score,
      weight: weights.restrictionMatch,
      contribution: restrictions.score * weights.restrictionMatch,
      explanation:
        restrictions.result === 'ok'
          ? 'Відповідає всім харчовим обмеженням родини'
          : restrictions.violations.map((v) => v.message).join('; '),
    },
    {
      key: 'budgetMatch',
      label: 'Бюджет',
      value: budget.value,
      weight: weights.budgetMatch,
      contribution: budget.value * weights.budgetMatch,
      explanation: budget.explanation,
    },
    {
      key: 'timeMatch',
      label: 'Час',
      value: time.value,
      weight: weights.timeMatch,
      contribution: time.value * weights.timeMatch,
      explanation: time.explanation,
    },
    {
      key: 'preferenceMatch',
      label: 'Смаки',
      value: preference.value,
      weight: weights.preferenceMatch,
      contribution: preference.value * weights.preferenceMatch,
      explanation: preference.explanation,
    },
  ]

  const raw = factors.reduce((sum, f) => sum + f.contribution, 0)
  // Обмеження — множник, а не доданок: алерген має обнуляти страву повністю.
  const score = restrictions.result === 'blocked' ? 0 : round3(raw)

  return {
    recipe,
    score,
    factors,
    coverage,
    restrictions,
    reason: buildReason(recipe, coverage, expiry, restrictions),
    blocked: restrictions.result === 'blocked',
    missingCost: coverage.approxMissingCost,
  }
}

/** Скорить, фільтрує заборонені й сортує за правилами з ТЗ. */
export function rankRecipes(recipes: RecipeLike[], req: ScoringRequest, limit = 5): ScoredRecipe[] {
  const scored = recipes.map((r) => scoreRecipe(r, req))
  const allowed = scored.filter((s) => !s.blocked)
  allowed.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score
    // 1. менше докупівлі
    if (a.coverage.missing.length !== b.coverage.missing.length) {
      return a.coverage.missing.length - b.coverage.missing.length
    }
    // 2. більше порятунку продуктів
    if (a.coverage.rescues.length !== b.coverage.rescues.length) {
      return b.coverage.rescues.length - a.coverage.rescues.length
    }
    // 3. дешевше
    if (a.missingCost !== b.missingCost) return a.missingCost - b.missingCost
    // 4. швидше
    return a.recipe.cookingTime - b.recipe.cookingTime
  })
  return allowed.slice(0, limit)
}

function expiryRescueScore(
  recipe: RecipeLike,
  pantry: PantryEntry[],
  coverage: CoverageResult,
  now: Date,
): { value: number; explanation: string; urgentNames: string[] } {
  const expiring = pantry.filter((p) => p.expiryDate && daysUntil(p.expiryDate, now) <= SOON_DAYS)
  if (expiring.length === 0) {
    return { value: 0.5, explanation: 'Немає продуктів із близьким терміном придатності', urgentNames: [] }
  }
  const rescued = expiring.filter((p) => coverage.rescues.includes(p.normalizedName))
  const urgent = rescued.filter((p) => daysUntil(p.expiryDate!, now) <= URGENT_DAYS)
  // терміновий продукт важить удвічі
  const weightSum = expiring.reduce((s, p) => s + (daysUntil(p.expiryDate!, now) <= URGENT_DAYS ? 2 : 1), 0)
  const gained = rescued.reduce((s, p) => s + (daysUntil(p.expiryDate!, now) <= URGENT_DAYS ? 2 : 1), 0)
  const value = weightSum === 0 ? 0.5 : clamp01(gained / weightSum)
  const names = uniqueNames(rescued)
  return {
    value,
    urgentNames: uniqueNames(urgent),
    explanation:
      names.length === 0
        ? 'Не використовує продукти, які скоро зіпсуються'
        : `Використовує ${formatNameList(names)} — ${names.length > 1 ? 'їх' : 'його'} варто спожити найближчим часом`,
  }
}

/** Максимум назв у переліку; решта згортається в «та ще N». */
const MAX_LISTED_NAMES = 3

/**
 * Унікальні назви продуктів для переліку в поясненні.
 *
 * Кілька рядків комори з одним ключем («Шпинат» ×3 і «Шпинат свіжий») — це
 * один продукт для користувача. Без згортання фраза перетворювалась на
 * «зокрема Шпинат і Шпинат і Шпинат і Шпинат свіжий»: скільки рядків
 * зматчилось, стільки разів назва й повторювалась.
 *
 * Ключ згортання — `normalizedName`, бо саме він визначає продукт; підпис
 * береться з першого рядка. Другий прохід прибирає випадкові збіги підписів
 * у різних ключів.
 */
function uniqueNames(entries: PantryEntry[]): string[] {
  const byKey = new Map<string, string>()
  for (const p of entries) {
    if (!byKey.has(p.normalizedName)) byKey.set(p.normalizedName, displayName(p.originalName))
  }
  return [...new Set(byKey.values())]
}

/** «А, Б і В» для короткого переліку, «А, Б, В та ще 2» — для довгого. */
function formatNameList(names: string[]): string {
  if (names.length > MAX_LISTED_NAMES) {
    return `${names.slice(0, MAX_LISTED_NAMES).join(', ')} та ще ${names.length - MAX_LISTED_NAMES}`
  }
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} і ${names[names.length - 1]}`
}

function budgetMatchScore(missingCost: Kopiyky, maxBudget: Kopiyky | null): { value: number; explanation: string } {
  if (missingCost === 0) return { value: 1, explanation: 'Докуповувати нічого не потрібно' }
  if (!maxBudget || maxBudget <= 0) {
    // без ліміту — дешевше все одно краще; 300 грн вважаємо нейтральною точкою
    const value = clamp01(1 - missingCost / 60_000)
    return { value, explanation: `Орієнтовна докупівля ≈ ${formatUah(missingCost)}` }
  }
  if (missingCost > maxBudget) {
    return { value: 0, explanation: `Докупівля ${formatUah(missingCost)} перевищує ліміт ${formatUah(maxBudget)}` }
  }
  return {
    value: clamp01(1 - missingCost / maxBudget),
    explanation: `Докупівля ${formatUah(missingCost)} вкладається в ліміт ${formatUah(maxBudget)}`,
  }
}

function timeMatchScore(cookingTime: number, maxMinutes: number): { value: number; explanation: string } {
  if (cookingTime <= maxMinutes) {
    return {
      value: clamp01(1 - cookingTime / (maxMinutes * 2)),
      explanation: `${cookingTime} хв — вкладається у ваш ліміт ${maxMinutes} хв`,
    }
  }
  const overshoot = (cookingTime - maxMinutes) / maxMinutes
  return { value: clamp01(0.5 - overshoot), explanation: `${cookingTime} хв — довше за ліміт ${maxMinutes} хв` }
}

function preferenceMatchScore(recipe: RecipeLike, household: HouseholdContext): { value: number; explanation: string } {
  const likes = household.members.flatMap((m) => m.preferences.map((p) => p.toLowerCase()))
  if (likes.length === 0) return { value: 0.5, explanation: 'Уподобання ще не задані' }
  const haystack = [
    recipe.title.toLowerCase(),
    recipe.cuisine.toLowerCase(),
    ...recipe.tags.map((t) => t.toLowerCase()),
    ...recipe.ingredients.map((i) => i.normalizedName),
  ]
  const hits = likes.filter((l) => haystack.some((h) => h.includes(l)))
  const hasChild = household.members.some((m) => m.type === 'child')
  const kidFriendly = recipe.tags.includes('kid-friendly')
  let value = clamp01(hits.length / Math.max(2, likes.length / 2))
  if (hasChild && kidFriendly) value = clamp01(value + 0.3)
  return {
    value,
    explanation:
      hits.length > 0
        ? `Збігається з уподобаннями: ${hits.join(', ')}`
        : hasChild && kidFriendly
          ? 'Підходить дітям'
          : 'Нейтрально щодо смаків родини',
  }
}

function coverageExplanation(coverage: CoverageResult): string {
  const pct = Math.round(coverage.coverage * 100)
  const haveCount = coverage.have.length
  const missCount = coverage.missing.filter((m) => !m.optional).length
  if (missCount === 0) return `Усі ${haveCount} інгредієнтів уже є вдома (${pct}%)`
  return `${haveCount} інгредієнтів є вдома, ${missCount} треба докупити (${pct}%)`
}

function buildReason(
  recipe: RecipeLike,
  coverage: CoverageResult,
  expiry: { urgentNames: string[] },
  restrictions: RestrictionCheck,
): string {
  const haveCount = coverage.have.length
  const parts: string[] = []
  if (haveCount > 0) {
    // узгоджуємо і іменник, і займенник: «1 продукт, який» vs «4 продукти, які»
    const noun = pluralize(haveCount, 'продукт', 'продукти', 'продуктів')
    const pronoun = pluralize(haveCount, 'який', 'які', 'які')
    parts.push(`Ця страва використовує ${haveCount} ${noun}, ${pronoun} вже є вдома`)
  } else {
    parts.push('Для цієї страви поки що немає продуктів удома')
  }
  if (expiry.urgentNames.length > 0) {
    parts.push(
      `зокрема ${formatNameList(expiry.urgentNames)}, ${expiry.urgentNames.length > 1 ? 'які' : 'який'} бажано використати до завтра`,
    )
  }
  const missCount = coverage.missing.filter((m) => !m.optional).length
  if (missCount === 0) parts.push('докуповувати нічого не треба')
  else parts.push(`докупити треба ${missCount} ${pluralize(missCount, 'позицію', 'позиції', 'позицій')} на ≈ ${formatUah(coverage.approxMissingCost)}`)
  if (restrictions.result === 'warning') {
    // знижуємо регістр лише першої літери: імена в дужках мають лишитись власними
    const message = restrictions.violations[0]?.message ?? ''
    parts.push(message ? message.charAt(0).toLowerCase() + message.slice(1) : '')
  }
  return `${parts.filter(Boolean).join(', ')}.`
}

export function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function formatUah(kopiyky: Kopiyky): string {
  const uah = kopiyky / 100
  return `${uah.toFixed(2).replace('.', ',')} грн`
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
