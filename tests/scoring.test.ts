import { describe, it, expect } from 'vitest'
import type { HouseholdContext, PantryEntry, RecipeLike, Restriction } from '@/lib/domain/types'
import { scoreRecipe, rankRecipes, WEIGHTS, formatUah, pluralize } from '@/lib/domain/scoring'
import { checkRecipeAgainstRestrictions, checkProductAgainstRestrictions } from '@/lib/domain/restrictions'

const localDate = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const NOW = localDate(2026, 9, 10)

function household(restrictions: Restriction[] = []): HouseholdContext {
  return {
    displayName: 'Антон',
    members: [
      { name: 'Антон', type: 'adult', age: 36, preferences: [] },
      { name: 'Марко', type: 'child', age: 8, preferences: [] },
    ],
    restrictions,
    weeklyBudget: 25_000,
    mealsPerDay: 3,
    maxCookMinutes: 40,
  }
}

function recipe(over: Partial<RecipeLike> = {}): RecipeLike {
  return {
    id: 'r',
    slug: 's',
    title: 'Страва',
    summary: '',
    servings: 2,
    cookingTime: 25,
    difficulty: 'easy',
    cuisine: 'Українська',
    mealType: 'dinner',
    imageEmoji: '🍲',
    tags: [],
    nutrition: { kcal: 400, protein: 20, fat: 10, carbs: 40 },
    ingredients: [{ name: 'Молоко', normalizedName: 'молоко', quantity: 200, unit: 'мл', approxPricePerUnit: 5 }],
    steps: [],
    ...over,
  }
}

function pantryItem(over: Partial<PantryEntry> & { normalizedName: string }): PantryEntry {
  return {
    id: over.normalizedName,
    originalName: over.originalName ?? over.normalizedName,
    category: 'Інше',
    quantity: 1000,
    unit: 'мл',
    expiryDate: null,
    storageLocation: 'fridge',
    source: 'manual',
    confidence: 1,
    needsConfirmation: false,
    ...over,
  } as PantryEntry
}

describe('ваги скорингу', () => {
  it('сума ваг дорівнює одиниці', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 6)
  })
})

describe('scoreRecipe', () => {
  it('повертає всі шість факторів із поясненнями українською', () => {
    const s = scoreRecipe(recipe(), { pantry: [], household: household(), now: NOW })
    expect(s.factors).toHaveLength(6)
    for (const f of s.factors) {
      expect(f.explanation.length).toBeGreaterThan(3)
      expect(f.contribution).toBeCloseTo(f.value * f.weight, 6)
    }
  })

  it('страва з повним покриттям має вищий бал за страву без продуктів', () => {
    const full = scoreRecipe(recipe(), {
      pantry: [pantryItem({ normalizedName: 'молоко' })],
      household: household(),
      now: NOW,
    })
    const empty = scoreRecipe(recipe(), { pantry: [], household: household(), now: NOW })
    expect(full.score).toBeGreaterThan(empty.score)
  })

  it('алерген обнуляє бал і позначає страву як заблоковану', () => {
    const s = scoreRecipe(recipe(), {
      pantry: [pantryItem({ normalizedName: 'молоко' })],
      household: household([{ restrictionType: 'allergy', value: 'лактоза', severity: 'critical', memberName: 'Марко' }]),
      now: NOW,
    })
    expect(s.blocked).toBe(true)
    expect(s.score).toBe(0)
  })

  it('режим порятунку піднімає страву, що використовує продукт із терміном «завтра»', () => {
    const pantry = [pantryItem({ normalizedName: 'молоко', expiryDate: localDate(2026, 9, 11) })]
    const normal = scoreRecipe(recipe(), { pantry, household: household(), now: NOW })
    const rescue = scoreRecipe(recipe(), { pantry, household: household(), rescueMode: true, now: NOW })
    expect(rescue.score).toBeGreaterThan(normal.score)
  })

  it('пояснення згадує назву продукту, який рятується', () => {
    const s = scoreRecipe(recipe(), {
      pantry: [pantryItem({ normalizedName: 'молоко', originalName: 'Молоко 2,5%', expiryDate: localDate(2026, 9, 11) })],
      household: household(),
      now: NOW,
    })
    expect(s.reason).toContain('Молоко 2,5%')
    expect(s.reason).toContain('до завтра')
  })

  it('перевищення бюджету обнуляє фактор бюджету, але не блокує страву', () => {
    const s = scoreRecipe(recipe(), {
      pantry: [],
      household: household(),
      maxBudget: 100,
      now: NOW,
    })
    const budget = s.factors.find((f) => f.key === 'budgetMatch')!
    expect(budget.value).toBe(0)
    expect(s.blocked).toBe(false)
  })
})

describe('rankRecipes', () => {
  it('виключає заблоковані страви зі списку', () => {
    const ok = recipe({ id: 'ok', title: 'Без молока', ingredients: [{ name: 'Рис', normalizedName: 'рис', quantity: 100, unit: 'г' }] })
    const blocked = recipe({ id: 'blocked', title: 'З молоком' })
    const ranked = rankRecipes([ok, blocked], {
      pantry: [],
      household: household([{ restrictionType: 'allergy', value: 'лактоза', severity: 'critical' }]),
      now: NOW,
    })
    expect(ranked.map((r) => r.recipe.id)).toEqual(['ok'])
  })

  it('за рівних балів першою йде страва з меншою докупівлею', () => {
    const cheap = recipe({ id: 'cheap', ingredients: [{ name: 'Рис', normalizedName: 'рис', quantity: 100, unit: 'г' }] })
    const expensive = recipe({
      id: 'expensive',
      ingredients: [
        { name: 'Рис', normalizedName: 'рис', quantity: 100, unit: 'г' },
        { name: 'Лосось', normalizedName: 'лосось', quantity: 400, unit: 'г' },
      ],
    })
    const ranked = rankRecipes([expensive, cheap], {
      pantry: [pantryItem({ normalizedName: 'рис', unit: 'г' })],
      household: household(),
      now: NOW,
    })
    expect(ranked[0].recipe.id).toBe('cheap')
  })

  it('обмежує кількість результатів', () => {
    const many = Array.from({ length: 8 }, (_, i) => recipe({ id: `r${i}`, slug: `s${i}` }))
    expect(rankRecipes(many, { pantry: [], household: household(), now: NOW }, 3)).toHaveLength(3)
  })
})

describe('перевірка обмежень', () => {
  it('алергія блокує, а «не любить» лише попереджає', () => {
    const spicy = recipe({ tags: ['spicy'] })
    const dislike = checkRecipeAgainstRestrictions(spicy, [
      { restrictionType: 'dislike', value: 'гостре', severity: 'medium', memberName: 'Марко' },
    ])
    expect(dislike.result).toBe('warning')
    expect(dislike.score).toBeGreaterThan(0)

    const allergy = checkRecipeAgainstRestrictions(recipe(), [
      { restrictionType: 'allergy', value: 'лактоза', severity: 'critical' },
    ])
    expect(allergy.result).toBe('blocked')
    expect(allergy.score).toBe(0)
  })

  it('вегетаріанська дієта блокує мʼясну страву', () => {
    const meat = recipe({ ingredients: [{ name: 'Куряче філе', normalizedName: 'куряче філе', quantity: 300, unit: 'г' }] })
    const check = checkRecipeAgainstRestrictions(meat, [
      { restrictionType: 'diet', value: 'vegetarian', severity: 'high' },
    ])
    expect(check.result).toBe('blocked')
  })

  it('за наявності алергії завжди додає попередження про перевірку упаковки', () => {
    const check = checkRecipeAgainstRestrictions(
      recipe({ ingredients: [{ name: 'Рис', normalizedName: 'рис', quantity: 100, unit: 'г' }] }),
      [{ restrictionType: 'allergy', value: 'арахіс', severity: 'critical' }],
    )
    expect(check.result).toBe('ok')
    expect(check.allergyNotice).toContain('перевіряйте склад')
  })

  it('товар із заявленим алергеном позначається як небезпечний', () => {
    const res = checkProductAgainstRestrictions(
      {
        productId: 'p1',
        name: 'Сир Маскарпоне',
        price: 12900,
        unit: 'г',
        packSize: 250,
        allergens: ['лактоза'],
      },
      [{ restrictionType: 'allergy', value: 'лактоза', severity: 'critical', memberName: 'Марко' }],
    )
    expect(res.safe).toBe(false)
    expect(res.messages[0]).toContain('Марко')
  })

  it('невідомий склад товару теж породжує попередження при алергії', () => {
    const res = checkProductAgainstRestrictions(
      { productId: 'p2', name: 'Печиво', price: 5000, unit: 'г', packSize: 200 },
      [{ restrictionType: 'allergy', value: 'арахіс', severity: 'critical' }],
    )
    expect(res.unknownComposition).toBe(true)
    expect(res.messages.join(' ')).toContain('перевірте упаковку')
  })
})

describe('форматування', () => {
  it('копійки форматуються як гривні з комою', () => {
    expect(formatUah(12900)).toBe('129,00 грн')
    expect(formatUah(0)).toBe('0,00 грн')
  })

  it('українські числівники узгоджуються правильно', () => {
    expect(pluralize(1, 'продукт', 'продукти', 'продуктів')).toBe('продукт')
    expect(pluralize(3, 'продукт', 'продукти', 'продуктів')).toBe('продукти')
    expect(pluralize(5, 'продукт', 'продукти', 'продуктів')).toBe('продуктів')
    expect(pluralize(11, 'продукт', 'продукти', 'продуктів')).toBe('продуктів')
    expect(pluralize(21, 'продукт', 'продукти', 'продуктів')).toBe('продукт')
  })
})
