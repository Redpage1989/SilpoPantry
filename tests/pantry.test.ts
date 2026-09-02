import { describe, it, expect } from 'vitest'
import type { PantryEntry, RecipeIngredient } from '@/lib/domain/types'
import {
  daysUntil,
  expiryStatus,
  findExpiringProducts,
  totalAvailable,
  planDeduction,
  estimateDaysOfFood,
  planPantryWrite,
} from '@/lib/domain/pantry'
import { convert, tryConvert, humanize, formatQuantity } from '@/lib/domain/units'

/**
 * Дати навмисно конструюємо в локальній зоні, а не через ISO-рядок з Z:
 * термін придатності — поняття календарного дня користувача, і саме
 * локальний день порівнює `daysUntil`.
 */
const localDate = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0)
const NOW = localDate(2026, 9, 10)

function item(p: Partial<PantryEntry> & { id: string; normalizedName: string }): PantryEntry {
  return {
    originalName: p.normalizedName,
    category: 'Інше',
    quantity: 1,
    unit: 'г',
    expiryDate: null,
    storageLocation: 'pantry',
    source: 'manual',
    confidence: 1,
    needsConfirmation: false,
    ...p,
  } as PantryEntry
}

describe('units', () => {
  it('конвертує в межах одного виміру', () => {
    expect(convert(1, 'кг', 'г')).toBe(1000)
    expect(convert(500, 'мл', 'л')).toBe(0.5)
    expect(convert(2, 'ст.л', 'мл')).toBe(30)
  })

  it('відмовляється змішувати масу з обʼємом — це псує підрахунок нестачі', () => {
    expect(() => convert(200, 'г', 'мл')).toThrow()
    expect(tryConvert(200, 'г', 'мл')).toBeNull()
  })

  it('приводить кількість до зручної одиниці', () => {
    expect(humanize(1500, 'г')).toEqual({ quantity: 1.5, unit: 'кг' })
    expect(humanize(0.5, 'л')).toEqual({ quantity: 500, unit: 'мл' })
    expect(formatQuantity(0.5, 'л')).toBe('0,5 л')
  })
})

describe('терміни придатності', () => {
  it('рахує дні до дати без урахування годин', () => {
    expect(daysUntil(localDate(2026, 9, 11, 6), NOW)).toBe(1)
    expect(daysUntil(localDate(2026, 9, 10, 23), NOW)).toBe(0)
    expect(daysUntil(localDate(2026, 9, 9, 23), NOW)).toBe(-1)
  })

  it('класифікує статуси', () => {
    expect(expiryStatus(localDate(2026, 9, 9), NOW)).toBe('expired')
    expect(expiryStatus(localDate(2026, 9, 11), NOW)).toBe('use_today')
    expect(expiryStatus(localDate(2026, 9, 13), NOW)).toBe('expiring_soon')
    expect(expiryStatus(localDate(2026, 10, 13), NOW)).toBe('fresh')
    expect(expiryStatus(null, NOW)).toBe('unknown')
  })

  it('повертає найтерміновіші продукти першими', () => {
    const items = [
      item({ id: '1', normalizedName: 'молоко', expiryDate: localDate(2026, 9, 13) }),
      item({ id: '2', normalizedName: 'шпинат', expiryDate: localDate(2026, 9, 11) }),
      item({ id: '3', normalizedName: 'макарони', expiryDate: localDate(2027, 1, 1) }),
    ]
    const res = findExpiringProducts(items, NOW)
    expect(res.map((r) => r.normalizedName)).toEqual(['шпинат', 'молоко'])
  })
})

describe('підрахунок залишків', () => {
  it('складає позиції одного інгредієнта в різних сумісних одиницях', () => {
    const items = [
      item({ id: '1', normalizedName: 'молоко', quantity: 0.7, unit: 'л' }),
      item({ id: '2', normalizedName: 'молоко', quantity: 300, unit: 'мл' }),
    ]
    expect(totalAvailable(items, 'молоко', 'мл')).toBe(1000)
  })

  it('ігнорує позиції з несумісним виміром замість хибного складання', () => {
    const items = [
      item({ id: '1', normalizedName: 'сир', quantity: 200, unit: 'г' }),
      item({ id: '2', normalizedName: 'сир', quantity: 1, unit: 'шт' }),
    ]
    expect(totalAvailable(items, 'сир', 'г')).toBe(200)
  })
})

describe('списання інгредієнтів після приготування', () => {
  const ing = (name: string, quantity: number, unit: RecipeIngredient['unit']): RecipeIngredient => ({
    name,
    normalizedName: name,
    quantity,
    unit,
  })

  it('списує спочатку продукт із найближчим терміном придатності', () => {
    const items = [
      item({ id: 'fresh', normalizedName: 'шпинат', quantity: 200, unit: 'г', expiryDate: localDate(2026, 9, 20) }),
      item({ id: 'urgent', normalizedName: 'шпинат', quantity: 150, unit: 'г', expiryDate: localDate(2026, 9, 11) }),
    ]
    const { plan } = planDeduction(items, [ing('шпинат', 100, 'г')], 1, NOW)
    expect(plan).toHaveLength(1)
    expect(plan[0].itemId).toBe('urgent')
    expect(plan[0].remaining).toBe(50)
    expect(plan[0].removed).toBe(false)
  })

  it('розподіляє списання між кількома позиціями і позначає спорожнілі', () => {
    const items = [
      item({ id: 'a', normalizedName: 'молоко', quantity: 200, unit: 'мл', expiryDate: localDate(2026, 9, 11) }),
      item({ id: 'b', normalizedName: 'молоко', quantity: 0.5, unit: 'л', expiryDate: localDate(2026, 9, 15) }),
    ]
    const { plan, shortfall } = planDeduction(items, [ing('молоко', 400, 'мл')], 1, NOW)
    expect(shortfall).toHaveLength(0)
    expect(plan).toHaveLength(2)
    expect(plan[0]).toMatchObject({ itemId: 'a', deducted: 200, removed: true })
    expect(plan[1]).toMatchObject({ itemId: 'b', unit: 'л', deducted: 0.2 })
    expect(plan[1].remaining).toBeCloseTo(0.3, 3)
  })

  it('масштабує списання під кількість порцій', () => {
    const items = [item({ id: 'a', normalizedName: 'яйця', quantity: 6, unit: 'шт' })]
    const { plan } = planDeduction(items, [ing('яйця', 2, 'шт')], 2, NOW)
    expect(plan[0].deducted).toBe(4)
    expect(plan[0].remaining).toBe(2)
  })

  it('повідомляє про нестачу замість того, щоб піти в мінус', () => {
    const items = [item({ id: 'a', normalizedName: 'цукор', quantity: 50, unit: 'г' })]
    const { plan, shortfall } = planDeduction(items, [ing('цукор', 200, 'г')], 1, NOW)
    expect(plan[0].remaining).toBe(0)
    expect(shortfall).toEqual([{ normalizedName: 'цукор', missing: 150, unit: 'г' }])
  })

  it('не списує один продукт двічі на два інгредієнти', () => {
    const items = [item({ id: 'a', normalizedName: 'молоко', quantity: 300, unit: 'мл' })]
    const { plan, shortfall } = planDeduction(items, [ing('молоко', 200, 'мл'), ing('молоко', 200, 'мл')], 1, NOW)
    const totalDeducted = plan.reduce((s, p) => s + p.deducted, 0)
    expect(totalDeducted).toBe(300)
    expect(shortfall[0].missing).toBe(100)
  })

  it('не чіпає необовʼязкові інгредієнти', () => {
    const items = [item({ id: 'a', normalizedName: 'базилік', quantity: 20, unit: 'г' })]
    const { plan } = planDeduction(items, [{ ...ing('базилік', 5, 'г'), optional: true }], 1, NOW)
    expect(plan).toHaveLength(0)
  })
})

describe('оцінка «на скільки днів вистачить»', () => {
  it('обмежується найдефіцитнішою групою продуктів', () => {
    const items = [
      item({ id: '1', normalizedName: 'яйця', quantity: 6, unit: 'шт' }),
      item({ id: '2', normalizedName: 'макарони', quantity: 400, unit: 'г' }),
      item({ id: '3', normalizedName: 'помідори', quantity: 3, unit: 'шт' }),
    ]
    const days = estimateDaysOfFood(items, 2, 3)
    expect(days).toBeGreaterThan(0)
    expect(days).toBeLessThan(10)
  })

  it('порожня комора — нуль днів', () => {
    expect(estimateDaysOfFood([], 2, 3)).toBe(0)
  })
})

describe('planPantryWrite — комора не роздвоюється', () => {
  const d = (iso: string) => new Date(`${iso}T12:00:00`)

  it('без наявного рядка створює новий', () => {
    expect(planPantryWrite(null, { quantity: 700, unit: 'мл', expiryDate: null, source: 'photo' })).toEqual({
      action: 'create',
    })
  })

  it('фото замінює кількість: воно показує запас, а не поповнення', () => {
    // саме той випадок, що дублював комору: чек дав 0,7 л, фото — 700 мл
    const plan = planPantryWrite(
      { id: 'milk', quantity: 0.7, unit: 'л', expiryDate: d('2026-09-06') },
      { quantity: 700, unit: 'мл', expiryDate: null, source: 'photo' },
    )
    expect(plan).toEqual({ action: 'merge', id: 'milk', quantity: 0.7, unit: 'л', expiryDate: d('2026-09-06') })
  })

  it('покупка додається до наявного', () => {
    const plan = planPantryWrite(
      { id: 'milk', quantity: 0.7, unit: 'л', expiryDate: d('2026-09-06') },
      { quantity: 900, unit: 'мл', expiryDate: d('2026-09-12'), source: 'offline_receipt' },
    )
    expect(plan).toMatchObject({ action: 'merge', id: 'milk', quantity: 1.6, unit: 'л' })
  })

  it('ручне додавання — теж поповнення, а не заміна', () => {
    const plan = planPantryWrite(
      { id: 'eggs', quantity: 6, unit: 'шт', expiryDate: null },
      { quantity: 4, unit: 'шт', expiryDate: null, source: 'manual' },
    )
    expect(plan).toMatchObject({ action: 'merge', quantity: 10 })
  })

  it('несумісні одиниці не зливаються: 200 г сиру і 1 шт — різні рядки', () => {
    const plan = planPantryWrite(
      { id: 'cheese', quantity: 200, unit: 'г', expiryDate: null },
      { quantity: 1, unit: 'шт', expiryDate: null, source: 'photo' },
    )
    expect(plan).toEqual({ action: 'create' })
  })

  it('невідомий термін не стирає відомий', () => {
    const plan = planPantryWrite(
      { id: 'spinach', quantity: 150, unit: 'г', expiryDate: d('2026-09-03') },
      { quantity: 100, unit: 'г', expiryDate: null, source: 'photo' },
    )
    expect(plan).toMatchObject({ expiryDate: d('2026-09-03') })
  })

  it('пізніший термін перемагає', () => {
    const plan = planPantryWrite(
      { id: 'milk', quantity: 1, unit: 'л', expiryDate: d('2026-09-03') },
      { quantity: 1, unit: 'л', expiryDate: d('2026-09-10'), source: 'offline_receipt' },
    )
    expect(plan).toMatchObject({ expiryDate: d('2026-09-10') })
  })
})
