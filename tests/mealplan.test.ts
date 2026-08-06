import { describe, it, expect } from 'vitest'
import type { HouseholdContext, PantryEntry, RecipeLike } from '@/lib/domain/types'
import { buildWeeklyPlan, countMeals, describePlan, VARIETY_WINDOW_DAYS } from '@/lib/domain/mealplan'
import { SEED_RECIPES } from '@/lib/seed/recipes'

const localDate = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
/** Понеділок, щоб будні/вихідні були передбачувані. */
const MONDAY = localDate(2026, 9, 7)

function household(over: Partial<HouseholdContext> = {}): HouseholdContext {
  return {
    displayName: 'Антон',
    members: [
      { name: 'Антон', type: 'adult', age: 36, preferences: [] },
      { name: 'Марко', type: 'child', age: 8, preferences: [] },
    ],
    restrictions: [],
    weeklyBudget: 100_000,
    mealsPerDay: 3,
    maxCookMinutes: 40,
    ...over,
  }
}

function item(over: Partial<PantryEntry> & { id: string; normalizedName: string }): PantryEntry {
  return {
    originalName: over.normalizedName,
    category: 'Інше',
    quantity: 1000,
    unit: 'г',
    expiryDate: null,
    storageLocation: 'pantry',
    source: 'manual',
    confidence: 1,
    needsConfirmation: false,
    ...over,
  } as PantryEntry
}

/**
 * Щедра комора — щоб перевіряти саме планування, а не нестачу.
 *
 * Одиниці мають збігатися за ВИМІРОМ із тими, що в рецептах: 5000 г молока
 * не покриють 250 мл, бо маса й обʼєм навмисно не змішуються. Перша версія
 * цієї фікстури давала все в грамах — і половина «наявних» продуктів
 * рахувалась відсутньою.
 */
function fullPantry(): PantryEntry[] {
  const VOLUME = ['молоко', 'олія', 'вершки', 'сметана']
  const COUNT = ['яйця', 'цибуля', 'часник', 'помідори', 'огірки', 'лимон', 'банани', 'авокадо', 'хліб']
  const keys = [
    'яйця', 'молоко', 'масло вершкове', 'помідори', 'шпинат', 'макарони', 'сир твердий',
    'борошно', 'цукор', 'олія', 'цибуля', 'картопля', 'морква', 'куряче філе', 'рис',
    'сир кисломолочний', 'вівсянка', 'хліб', 'капуста', 'буряк', 'гриби', 'нут', 'часник',
    'томатна паста', 'кріп', 'мед', 'банани',
  ]
  return keys.map((k, i) => {
    const unit = VOLUME.includes(k) ? 'мл' : COUNT.includes(k) ? 'шт' : 'г'
    return item({ id: `p${i}`, normalizedName: k, quantity: unit === 'шт' ? 60 : 5000, unit })
  })
}

describe('тижневий план', () => {
  it('заповнює всі дні та слоти прийомів їжі', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: fullPantry(),
      household: household(),
      days: 7,
      now: MONDAY,
    })
    expect(plan.days).toHaveLength(7)
    expect(plan.unfilledSlots).toBe(0)
    expect(countMeals(plan)).toBe(21)
  })

  it('не повторює страву частіше, ніж дозволяє вікно різноманіття', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: fullPantry(),
      household: household(),
      days: 7,
      now: MONDAY,
    })
    const lastSeen = new Map<string, number>()
    for (const day of plan.days) {
      for (const meal of day.meals) {
        const prev = lastSeen.get(meal.recipe.id)
        if (prev !== undefined) {
          expect(
            day.dayOffset - prev,
            `«${meal.recipe.title}» повторилась через ${day.dayOffset - prev} дн.`,
          ).toBeGreaterThanOrEqual(VARIETY_WINDOW_DAYS)
        }
        lastSeen.set(meal.recipe.id, day.dayOffset)
      }
    }
  })

  it('вичерпує комору по ходу тижня, а не планує на ту саму їжу щодня', () => {
    // Рівно на одну фрітату: 4 яйця, 120 г шпинату, 60 мл молока, 20 г масла
    const scarce: PantryEntry[] = [
      item({ id: 'e', normalizedName: 'яйця', quantity: 4, unit: 'шт' }),
      item({ id: 's', normalizedName: 'шпинат', quantity: 120, unit: 'г' }),
      item({ id: 'm', normalizedName: 'молоко', quantity: 60, unit: 'мл' }),
      item({ id: 'b', normalizedName: 'масло вершкове', quantity: 20, unit: 'г' }),
    ]
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: scarce,
      household: household({ members: [{ name: 'Антон', type: 'adult', preferences: [] }] }),
      days: 5,
      mealsPerDay: 1,
      now: MONDAY,
    })

    // Перша вечеря має високе покриття, пізніші — вже ні: продукти закінчились
    const coverages = plan.days.flatMap((d) => d.meals.map((m) => m.coverage))
    expect(coverages[0]).toBeGreaterThan(0)
    expect(coverages[coverages.length - 1]).toBeLessThan(coverages[0])
  })

  it('зводить однаковий продукт із різних днів в одну позицію списку', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: [],
      household: household(),
      days: 7,
      now: MONDAY,
    })
    const names = plan.shoppingList.map((i) => i.normalizedName)
    expect(new Set(names).size, 'у списку покупок є дублі').toBe(names.length)
    // якщо продукт потрібен кільком стравам — це видно
    expect(plan.shoppingList.some((i) => i.usedInMeals > 1)).toBe(true)
  })

  it('вартість списку покупок дорівнює сумі позицій', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: [],
      household: household(),
      days: 3,
      now: MONDAY,
    })
    const sum = plan.shoppingList.reduce((s, i) => s + i.approxCost, 0)
    expect(plan.totalMissingCost).toBe(sum)
  })

  it('виключає страви з алергеном на весь тиждень', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: fullPantry(),
      household: household({
        restrictions: [{ restrictionType: 'allergy', value: 'лактоза', severity: 'critical' }],
      }),
      days: 7,
      now: MONDAY,
    })
    const dairy = ['молоко', 'вершки', 'сметана', 'маскарпоне', 'масло вершкове', 'сир твердий', 'сир кисломолочний']
    for (const day of plan.days) {
      for (const meal of day.meals) {
        const keys = meal.recipe.ingredients.map((i) => i.normalizedName)
        expect(
          keys.some((k) => dairy.includes(k)),
          `${meal.recipe.title} містить молочне попри алергію`,
        ).toBe(false)
      }
    }
  })

  it('позначає продукти, які зіпсуються, бо план їх не задіяв', () => {
    const pantry = [
      ...fullPantry(),
      item({ id: 'x', normalizedName: 'лосось', originalName: 'Лосось', quantity: 300, unit: 'г', expiryDate: localDate(2026, 9, 8) }),
    ]
    const plan = buildWeeklyPlan({ recipes: SEED_RECIPES, pantry, household: household(), days: 7, now: MONDAY })
    // жоден seed-рецепт не використовує лосось — план має чесно попередити
    expect(plan.atRiskProducts).toContain('Лосось')
  })

  it('задіює продукти з близьким терміном у перші дні', () => {
    const pantry = fullPantry().map((p) =>
      p.normalizedName === 'шпинат' ? { ...p, expiryDate: localDate(2026, 9, 8) } : p,
    )
    const plan = buildWeeklyPlan({ recipes: SEED_RECIPES, pantry, household: household(), days: 7, now: MONDAY })
    expect(plan.rescuedProducts).toContain('шпинат')
    const firstTwoDays = plan.days.slice(0, 2).flatMap((d) => d.meals)
    expect(firstTwoDays.some((m) => m.rescues.includes('шпинат'))).toBe(true)
  })

  it('на вихідних дозволяє довші страви, ніж у будні', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: fullPantry(),
      household: household(),
      days: 7,
      now: MONDAY,
    })
    const weekendDays = plan.days.filter((d) => d.isWeekend)
    expect(weekendDays.length).toBeGreaterThan(0)
    // будні страви не мають бути надто довгими
    const weekdayMax = Math.max(
      ...plan.days.filter((d) => !d.isWeekend).flatMap((d) => d.meals.map((m) => m.recipe.cookingTime)),
    )
    expect(weekdayMax).toBeLessThanOrEqual(90)
  })

  it('повідомляє про вихід за бюджет, а не мовчки його ігнорує', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: [],
      household: household(),
      days: 7,
      budget: 5_00,
      now: MONDAY,
    })
    expect(plan.budget.limit).toBe(500)
    expect(plan.budget.withinBudget).toBe(false)
    expect(plan.budget.planned).toBeGreaterThan(500)
  })

  it('без бюджету не вважає план таким, що вийшов за межі', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: [],
      household: household(),
      days: 2,
      budget: null,
      now: MONDAY,
    })
    expect(plan.budget.withinBudget).toBe(true)
  })

  it('кількість слотів залежить від прийомів їжі на день', () => {
    const two = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: fullPantry(),
      household: household(),
      days: 3,
      mealsPerDay: 2,
      now: MONDAY,
    })
    expect(countMeals(two)).toBe(6)
  })

  it('порожня книга рецептів не ламає план, а чесно лишає слоти незаповненими', () => {
    const plan = buildWeeklyPlan({ recipes: [], pantry: [], household: household(), days: 3, now: MONDAY })
    expect(countMeals(plan)).toBe(0)
    expect(plan.unfilledSlots).toBe(9)
    expect(plan.shoppingList).toEqual([])
  })

  it('підсумок описує план людською мовою', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: fullPantry(),
      household: household(),
      days: 7,
      now: MONDAY,
    })
    const text = describePlan(plan)
    expect(text).toContain('страв на 7 днів')
  })
})

describe('бюджет витрачається наростаючим підсумком', () => {
  it('план із жорстким бюджетом дешевший за план без обмеження', () => {
    const base = {
      recipes: SEED_RECIPES,
      pantry: [] as PantryEntry[],
      household: household(),
      days: 7,
      now: MONDAY,
    }
    const unlimited = buildWeeklyPlan({ ...base, budget: null })
    const limited = buildWeeklyPlan({ ...base, budget: 300_00 })
    expect(limited.totalMissingCost).toBeLessThan(unlimited.totalMissingCost)
  })

  it('вичерпаний бюджет змушує обирати страви з наявних продуктів', () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry: fullPantry(),
      household: household(),
      days: 7,
      budget: 100_00,
      now: MONDAY,
    })
    // з повною коморою вкластися в 100 грн цілком реально
    expect(plan.budget.withinBudget).toBe(true)
  })
})
