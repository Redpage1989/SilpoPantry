import { describe, it, expect } from 'vitest'
import { ALLERGEN_SOURCES, allergensImpliedBy } from '@/lib/domain/restrictions'
import { canonicalKeys } from '@/lib/domain/normalize'
import {
  checkRecipeAgainstRestrictions,
  checkProductAgainstRestrictions,
} from '@/lib/domain/restrictions'
import type { ProductOption, RecipeLike, Restriction } from '@/lib/domain/types'

/**
 * Фільтр алергенів — найнебезпечніший код у застосунку, і до цього він
 * не мав жодного тесту. Тут перевіряється не зручність, а те, чи може
 * страва з алергеном пройти в раціон родини.
 */

const recipe = (over: Partial<RecipeLike> = {}): RecipeLike => ({
  id: 'r1',
  slug: 'r1',
  title: 'Страва',
  summary: '',
  servings: 2,
  cookingTime: 20,
  difficulty: 'easy',
  cuisine: 'Українська',
  mealType: 'dinner',
  imageEmoji: '🍽️',
  tags: [],
  nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  ingredients: [],
  steps: [],
  ...over,
})

const ing = (normalizedName: string) => ({ name: normalizedName, normalizedName, quantity: 100, unit: 'г' as const })

const allergy = (value: string): Restriction => ({ restrictionType: 'allergy', value, severity: 'critical' })

describe('алергія блокує страву повністю', () => {
  it('прямий інгредієнт', () => {
    const res = checkRecipeAgainstRestrictions(recipe({ ingredients: [ing('арахіс')] }), [allergy('арахіс')])
    expect(res.result).toBe('blocked')
    // нуль, а не знижений бал: множник у скорингу має відсіяти страву, а не посунути її
    expect(res.score).toBe(0)
  })

  it('похідний продукт через таблицю джерел', () => {
    // лактоза ховається в маскарпоне, а не в слові «лактоза»
    const res = checkRecipeAgainstRestrictions(recipe({ ingredients: [ing('маскарпоне')] }), [allergy('лактоза')])
    expect(res.result).toBe('blocked')
    expect(res.violations[0].trigger).toBe('маскарпоне')
  })

  it('савоярді блокується і за глютеном, і за яйцями', () => {
    const res = checkRecipeAgainstRestrictions(recipe({ ingredients: [ing('савоярді')] }), [
      allergy('глютен'),
      allergy('яйця'),
    ])
    expect(res.violations).toHaveLength(2)
  })

  it('попередження про алергію лишається навіть у безпечній страві', () => {
    const res = checkRecipeAgainstRestrictions(recipe({ ingredients: [ing('картопля')] }), [allergy('арахіс')])
    expect(res.result).toBe('ok')
    expect(res.allergyNotice).toBeTruthy()
  })
})

describe('заявлені автором алергени блокують нарівні з інгредієнтами', () => {
  /**
   * До виправлення декларація автора лише малювалась у стрічці. Родина з
   * алергією на арахіс могла отримати в раціон рецепт, у якому автор
   * ПРЯМО вказав арахіс, бо серед інгредієнтів слова «арахіс» не було.
   */
  it('арахіс у декларації блокує, хоча інгредієнти його не називають', () => {
    const soup = recipe({
      ingredients: [ing('локшина'), ing('курка')],
      declaredAllergens: ['арахіс'],
    })
    const res = checkRecipeAgainstRestrictions(soup, [allergy('арахіс')])
    expect(res.result).toBe('blocked')
  })

  it('без декларації той самий рецепт не блокується — саме тому декларація й потрібна', () => {
    const soup = recipe({ ingredients: [ing('локшина'), ing('курка')] })
    expect(checkRecipeAgainstRestrictions(soup, [allergy('арахіс')]).result).not.toBe('blocked')
  })

  it('декларація іншого алергену не блокує зайвого', () => {
    const dish = recipe({ ingredients: [ing('локшина')], declaredAllergens: ['соя'] })
    expect(checkRecipeAgainstRestrictions(dish, [allergy('арахіс')]).result).toBe('ok')
  })

  it('регістр і пробіли в декларації не ламають перевірку', () => {
    const dish = recipe({ ingredients: [ing('локшина')], declaredAllergens: ['  Арахіс '] })
    expect(checkRecipeAgainstRestrictions(dish, [allergy('арахіс')]).result).toBe('blocked')
  })
})

describe('дієти й нелюбі продукти', () => {
  it('критична дієта блокує, некритична лише попереджає', () => {
    const meat = recipe({ ingredients: [ing('свинина')] })
    const strict: Restriction = { restrictionType: 'diet', value: 'vegetarian', severity: 'critical' }
    const soft: Restriction = { restrictionType: 'diet', value: 'vegetarian', severity: 'low' }
    expect(checkRecipeAgainstRestrictions(meat, [strict]).result).toBe('blocked')
    expect(checkRecipeAgainstRestrictions(meat, [soft]).result).toBe('warning')
  })

  it('«не любить гостре» знижує бал, але лишає вибір', () => {
    const spicy = recipe({ tags: ['spicy'], ingredients: [ing('перець')] })
    const res = checkRecipeAgainstRestrictions(spicy, [
      { restrictionType: 'dislike', value: 'гостре', severity: 'low' },
    ])
    expect(res.result).toBe('warning')
    expect(res.score).toBeGreaterThan(0)
    expect(res.score).toBeLessThan(1)
  })

  it('кожне попередження знижує бал, але не до нуля', () => {
    const dish = recipe({ tags: ['spicy', 'sour'], ingredients: [ing('перець')] })
    const res = checkRecipeAgainstRestrictions(dish, [
      { restrictionType: 'dislike', value: 'гостре', severity: 'low' },
      { restrictionType: 'dislike', value: 'кисле', severity: 'low' },
    ])
    expect(res.score).toBeCloseTo(0.5, 5)
  })
})

describe('перевірка товару «Сільпо»', () => {
  const product = (over: Partial<ProductOption> = {}): ProductOption => ({
    productId: 'p1',
    name: 'Молоко «Яготинське» 2,6%',
    price: 4500,
    unit: 'мл',
    packSize: 900,
    ...over,
  })

  it('невідомий склад не видається за безпечний — про це кажуть прямо', () => {
    const res = checkProductAgainstRestrictions(product({ allergens: undefined }), [allergy('арахіс')])
    expect(res.unknownComposition).toBe(true)
    expect(res.messages.join(' ')).toContain('перевірте упаковку')
  })

  it('заявлений склад товару спрацьовує', () => {
    const res = checkProductAgainstRestrictions(product({ allergens: ['лактоза'] }), [allergy('лактоза')])
    expect(res.safe).toBe(false)
  })

  it('склад є і алергену немає — товар не позначається зайвим попередженням', () => {
    const res = checkProductAgainstRestrictions(product({ allergens: ['лактоза'] }), [allergy('арахіс')])
    expect(res.safe).toBe(true)
    expect(res.unknownComposition).toBe(false)
    expect(res.messages).toHaveLength(0)
  })
})

describe('словник знає кожен носій алергену', () => {
  /**
   * Сторож, якого бракувало. Модерація виводить алергени з РОЗПІЗНАНОГО
   * складу: якщо словник не знає «мигдаль», інгредієнт лишається
   * нерозпізнаним, `allergensImpliedBy` не бачить горіхів — і рецепт
   * публікується без декларації. Перевірка тримає обидва списки разом.
   */
  it('кожен інгредієнт з ALLERGEN_SOURCES є канонічним ключем', () => {
    const keys = new Set(canonicalKeys())
    const missing = [...new Set(Object.values(ALLERGEN_SOURCES).flat())].filter((s) => !keys.has(s))
    expect(missing, `словник не знає: ${missing.join(', ')}`).toEqual([])
  })

  it('носій алергену справді тягне за собою алерген', () => {
    expect(allergensImpliedBy(['мигдаль'])).toContain('горіхи')
    expect(allergensImpliedBy(['креветки'])).toContain('морепродукти')
    expect(allergensImpliedBy(['тофу'])).toContain('соя')
    expect(allergensImpliedBy(['манка'])).toContain('глютен')
  })
})
