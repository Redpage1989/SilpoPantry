import type { HouseholdContext, PantryEntry, RecipeLike, MealType, Kopiyky, MissingIngredient } from './types'
import { rankRecipes, type ScoredRecipe } from './scoring'
import { planDeduction } from './pantry'
import { daysUntil } from './pantry'

/**
 * Планування раціону на тиждень.
 *
 * Головна складність тут — НЕ підбір страв. Наївний план просто скорить
 * рецепти сім разів поспіль і отримує сім однакових вечерь зі шпинатом:
 * кожен день «бачить» ту саму повну комору.
 *
 * Тому план симулює споживання: після кожної запланованої страви залишки
 * зменшуються, і наступний день рахується вже на тому, що реально лишиться.
 * Це також єдиний спосіб чесно порахувати підсумковий список покупок —
 * інакше молоко з понеділка «покриє» ще й четвер.
 */

/** Скільки днів поспіль не повторювати ту саму страву. */
export const VARIETY_WINDOW_DAYS = 3

/** Скільки варіантів розглядати, коли бюджет вичерпано. */
const BUDGET_FALLBACK_CANDIDATES = 8

/** У будні часу менше, ніж на вихідних — це впливає на добір страв. */
const WEEKDAY_MINUTES = 35
const WEEKEND_MINUTES = 90

export interface PlannedMeal {
  mealType: MealType
  recipe: RecipeLike
  servings: number
  /** що з інгредієнтів довелось би докупити саме для цієї страви */
  missing: MissingIngredient[]
  missingCost: Kopiyky
  /** продукти з близьким терміном, які ця страва рятує */
  rescues: string[]
  reason: string
  coverage: number
}

export interface PlannedDay {
  /** зсув від старту плану: 0 — сьогодні */
  dayOffset: number
  date: Date
  isWeekend: boolean
  meals: PlannedMeal[]
}

export interface AggregatedItem {
  normalizedName: string
  name: string
  quantity: number
  unit: string
  approxCost: Kopiyky
  /** для скількох страв тижня потрібен цей продукт */
  usedInMeals: number
}

export interface WeeklyPlan {
  days: PlannedDay[]
  /** зведений список покупок на весь тиждень, без дублів */
  shoppingList: AggregatedItem[]
  totalMissingCost: Kopiyky
  /** скільки продуктів із близьким терміном вдалося задіяти */
  rescuedProducts: string[]
  /** продукти, що зіпсуються, бо жодна страва їх не використала */
  atRiskProducts: string[]
  budget: { limit: Kopiyky | null; planned: Kopiyky; withinBudget: boolean }
  /** слоти, для яких не знайшлось жодної придатної страви */
  unfilledSlots: number
}

export interface WeeklyPlanRequest {
  recipes: RecipeLike[]
  pantry: PantryEntry[]
  household: HouseholdContext
  days?: number
  /** переозначити кількість прийомів їжі на день */
  mealsPerDay?: number
  /** бюджет на весь період; null — без обмеження */
  budget?: Kopiyky | null
  now?: Date
}

/** Які прийоми їжі планувати за їхньою кількістю на день. */
function mealSlotsFor(mealsPerDay: number): MealType[] {
  if (mealsPerDay <= 1) return ['dinner']
  if (mealsPerDay === 2) return ['lunch', 'dinner']
  if (mealsPerDay === 3) return ['breakfast', 'lunch', 'dinner']
  return ['breakfast', 'lunch', 'dinner', 'snack']
}

export function buildWeeklyPlan(req: WeeklyPlanRequest): WeeklyPlan {
  const now = req.now ?? new Date()
  const dayCount = clamp(req.days ?? 7, 1, 14)
  const mealsPerDay = clamp(req.mealsPerDay ?? req.household.mealsPerDay, 1, 4)
  const slots = mealSlotsFor(mealsPerDay)
  const people = Math.max(1, req.household.members.length)
  const budgetLimit = req.budget === undefined ? req.household.weeklyBudget : req.budget

  // Робоча копія комори: саме вона зменшується протягом планування.
  let workingPantry: PantryEntry[] = req.pantry.map((p) => ({ ...p }))

  const days: PlannedDay[] = []
  /** recipeId → день, коли страву вже готували */
  const lastUsedOn = new Map<string, number>()
  /**
   * Бюджет витрачається наростаючим підсумком. Без цього кожна страва
   * бачила б повний ліміт і план стабільно вилітав за бюджет, лише
   * повідомляючи про це постфактум.
   */
  let budgetLeft = budgetLimit ?? null
  const aggregated = new Map<string, AggregatedItem>()
  const rescued = new Set<string>()
  let unfilledSlots = 0

  for (let dayOffset = 0; dayOffset < dayCount; dayOffset++) {
    const date = addDays(now, dayOffset)
    const weekend = isWeekend(date)
    const meals: PlannedMeal[] = []

    for (const mealType of slots) {
      const candidates = req.recipes.filter((r) => {
        if (r.mealType !== mealType) return false
        const usedOn = lastUsedOn.get(r.id)
        // не повторюємо страву раніше, ніж через VARIETY_WINDOW_DAYS днів
        return usedOn === undefined || dayOffset - usedOn >= VARIETY_WINDOW_DAYS
      })

      if (candidates.length === 0) {
        unfilledSlots += 1
        continue
      }

      const budgetExhausted = budgetLeft !== null && budgetLeft <= 0
      const ranked = rankRecipes(
        candidates,
        {
          pantry: workingPantry,
          household: req.household,
          servings: people,
          maxMinutes: weekend ? WEEKEND_MINUTES : WEEKDAY_MINUTES,
          // залишок бюджету, а не повний ліміт
          maxBudget: budgetLeft,
          // Продукти, що псуються, треба задіяти в перші дні — далі вони
          // просто зіпсуються, і план на них розраховувати не може.
          rescueMode: dayOffset <= 1,
          now,
        },
        // коли бюджет скінчився, потрібен вибір, а не єдиний найкращий за балом
        budgetExhausted ? BUDGET_FALLBACK_CANDIDATES : 1,
      )

      /**
       * Бюджет — обмеження, а не просто фактор із вагою 0,10.
       * Щойно він вичерпаний, агент переходить на страви з мінімальною
       * докупівлею: краще приготувати з наявного, ніж мовчки виставити
       * рахунок, якого користувач не просив.
       */
      const best = budgetExhausted
        ? [...ranked].sort((a, b) => a.missingCost - b.missingCost)[0]
        : ranked[0]
      if (!best) {
        unfilledSlots += 1
        continue
      }

      meals.push(toPlannedMeal(best, people))
      lastUsedOn.set(best.recipe.id, dayOffset)
      if (budgetLeft !== null) budgetLeft = Math.max(0, budgetLeft - best.missingCost)
      best.coverage.rescues.forEach((r) => rescued.add(r))

      // Зведений список покупок: однаковий продукт у різні дні — одна позиція
      for (const miss of best.coverage.missing.filter((m) => !m.optional)) {
        const existing = aggregated.get(miss.normalizedName)
        if (existing && existing.unit === miss.unit) {
          existing.quantity = round2(existing.quantity + miss.missing)
          existing.approxCost += miss.approxCost
          existing.usedInMeals += 1
        } else if (!existing) {
          aggregated.set(miss.normalizedName, {
            normalizedName: miss.normalizedName,
            name: miss.name,
            quantity: round2(miss.missing),
            unit: miss.unit,
            approxCost: miss.approxCost,
            usedInMeals: 1,
          })
        }
      }

      // Ключовий крок: списуємо з робочої комори те, що страва спожила.
      workingPantry = applyConsumption(workingPantry, best, people, now)
    }

    days.push({ dayOffset, date, isWeekend: weekend, meals })
  }

  const totalMissingCost = [...aggregated.values()].reduce((s, i) => s + i.approxCost, 0)

  return {
    days,
    shoppingList: [...aggregated.values()].sort((a, b) => b.approxCost - a.approxCost),
    totalMissingCost,
    rescuedProducts: [...rescued],
    atRiskProducts: findAtRisk(req.pantry, rescued, now),
    budget: {
      limit: budgetLimit,
      planned: totalMissingCost,
      withinBudget: budgetLimit === null || budgetLimit === undefined ? true : totalMissingCost <= budgetLimit,
    },
    unfilledSlots,
  }
}

function toPlannedMeal(scored: ScoredRecipe, servings: number): PlannedMeal {
  return {
    mealType: scored.recipe.mealType,
    recipe: scored.recipe,
    servings,
    missing: scored.coverage.missing.filter((m) => !m.optional),
    missingCost: scored.missingCost,
    rescues: scored.coverage.rescues,
    reason: scored.reason,
    coverage: scored.coverage.coverage,
  }
}

/**
 * Зменшує залишки на те, що спожила страва.
 * Використовує ту саму `planDeduction`, що й реальне списання після
 * «Я це приготував» — щоб симуляція і факт не розходились.
 */
function applyConsumption(
  pantry: PantryEntry[],
  scored: ScoredRecipe,
  servings: number,
  now: Date,
): PantryEntry[] {
  const multiplier = servings / scored.recipe.servings
  const { plan } = planDeduction(pantry, scored.recipe.ingredients, multiplier, now)
  const remainingById = new Map(plan.map((line) => [line.itemId, line.remaining]))

  return pantry
    .map((item) => (remainingById.has(item.id) ? { ...item, quantity: remainingById.get(item.id)! } : item))
    .filter((item) => item.quantity > 0.0001)
}

/** Продукти з близьким терміном, які план так і не задіяв. */
function findAtRisk(pantry: PantryEntry[], rescued: Set<string>, now: Date): string[] {
  return pantry
    .filter((p) => p.expiryDate !== null && daysUntil(p.expiryDate, now) <= 3)
    .filter((p) => !rescued.has(p.normalizedName))
    .map((p) => p.originalName)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  d.setHours(12, 0, 0, 0)
  return d
}

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Скільки страв у плані — для коротких підсумків в UI. */
export function countMeals(plan: WeeklyPlan): number {
  return plan.days.reduce((sum, d) => sum + d.meals.length, 0)
}

/** Людяний підсумок плану однією фразою. */
export function describePlan(plan: WeeklyPlan): string {
  const meals = countMeals(plan)
  const parts = [`${meals} страв на ${plan.days.length} днів`]
  if (plan.rescuedProducts.length > 0) {
    parts.push(`задіяно ${plan.rescuedProducts.length} продуктів, що псуються`)
  }
  if (plan.shoppingList.length > 0) {
    parts.push(`докупити ${plan.shoppingList.length} позицій`)
  } else {
    parts.push('докуповувати нічого не треба')
  }
  return parts.join(' · ')
}
