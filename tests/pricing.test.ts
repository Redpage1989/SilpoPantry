import { describe, it, expect } from 'vitest'
import type { MissingIngredient, ProductOption } from '@/lib/domain/types'
import {
  effectivePrice,
  packsNeeded,
  consumedFraction,
  pricePerBaseUnit,
  buildTiers,
  sumBasket,
  compareCookVsReady,
  estimateServingsPerPack,
} from '@/lib/domain/pricing'
import { isPlausibleReadyMeal } from '@/lib/agent/tools'

function product(over: Partial<ProductOption> & { productId: string }): ProductOption {
  return {
    name: over.name ?? over.productId,
    price: 10000,
    unit: 'г',
    packSize: 100,
    ...over,
  } as ProductOption
}

const missing = (over: Partial<MissingIngredient> = {}): MissingIngredient => ({
  name: 'Маскарпоне',
  normalizedName: 'маскарпоне',
  needed: 500,
  have: 250,
  missing: 250,
  unit: 'г',
  kind: 'insufficient',
  optional: false,
  approxCost: 15000,
  ...over,
})

describe('ціни', () => {
  it('акційна ціна застосовується, лише якщо вона нижча', () => {
    expect(effectivePrice(product({ productId: 'a', price: 10000, promoPrice: 8000 }))).toBe(8000)
    expect(effectivePrice(product({ productId: 'b', price: 10000, promoPrice: 12000 }))).toBe(10000)
    expect(effectivePrice(product({ productId: 'c', price: 10000 }))).toBe(10000)
  })

  it('ціна за базову одиницю дозволяє порівняти різні упаковки', () => {
    const small = product({ productId: 's', price: 12900, packSize: 250, unit: 'г' })
    const large = product({ productId: 'l', price: 19900, packSize: 500, unit: 'г' })
    expect(pricePerBaseUnit(large)).toBeLessThan(pricePerBaseUnit(small))
  })

  it('упаковки не діляться: 250 г потреби з пачки 200 г = 2 пачки', () => {
    expect(packsNeeded(250, 'г', product({ productId: 'p', packSize: 200, unit: 'г' }))).toBe(2)
    expect(packsNeeded(150, 'г', product({ productId: 'p', packSize: 200, unit: 'г' }))).toBe(1)
  })

  it('несумісні одиниці не дають вигаданої кількості упаковок', () => {
    // 300 мл кави проти пачки 250 г — не рахуємо 2 пачки
    expect(packsNeeded(300, 'мл', product({ productId: 'coffee', packSize: 250, unit: 'г' }))).toBe(1)
  })

  it('спожита частка показує, скільки з пачки піде у страву', () => {
    const pack = product({ productId: 'cocoa', packSize: 100, unit: 'г' })
    expect(consumedFraction(20, 'г', pack, 1)).toBe(0.2)
    expect(consumedFraction(200, 'г', pack, 2)).toBe(1)
  })
})

describe('цінові рівні', () => {
  const options = [
    product({ productId: 'cheap', name: 'Бюджетний 250 г', price: 12900, packSize: 250, rating: 4.4 }),
    product({ productId: 'mid', name: 'Середній 500 г', price: 27900, packSize: 500, rating: 4.6 }),
    product({ productId: 'lux', name: 'Преміум 250 г', price: 18900, promoPrice: 15900, packSize: 250, rating: 4.8 }),
  ]

  it('повертає три РІЗНІ товари, коли варіантів достатньо', () => {
    const tiers = buildTiers(options, missing())
    expect(tiers).toHaveLength(3)
    expect(new Set(tiers.map((t) => t.product.productId)).size).toBe(3)
    expect(tiers.map((t) => t.tier)).toEqual(['budget', 'optimal', 'premium'])
  })

  it('бюджетний — найдешевший за базову одиницю', () => {
    const tiers = buildTiers(options, missing())
    const budget = tiers.find((t) => t.tier === 'budget')!
    const others = tiers.filter((t) => t.tier !== 'budget')
    for (const o of others) {
      expect(pricePerBaseUnit(budget.product)).toBeLessThanOrEqual(pricePerBaseUnit(o.product))
    }
  })

  it('рахує економію за акцією і залишок про запас', () => {
    const tiers = buildTiers(options, missing({ missing: 100 }))
    const premium = tiers.find((t) => t.tier === 'premium')!
    expect(premium.promoSaving).toBe(3000)
    expect(premium.consumedValue + premium.leftoverValue).toBe(premium.lineTotal)
    expect(premium.leftoverValue).toBeGreaterThan(0)
  })

  it('не вигадує дублікати, коли товар лише один', () => {
    const tiers = buildTiers([options[0]], missing())
    expect(tiers).toHaveLength(1)
  })

  it('порожній список товарів дає порожній результат', () => {
    expect(buildTiers([], missing())).toEqual([])
  })
})

describe('підсумок кошика', () => {
  it('сума, економія та кількість рахуються з рядків', () => {
    const totals = sumBasket([
      { lineTotal: 10000, promoSaving: 2000, quantity: 1 },
      { lineTotal: 5000, promoSaving: 0, quantity: 2 },
    ])
    expect(totals.subtotal).toBe(17000)
    expect(totals.promoSaving).toBe(2000)
    expect(totals.total).toBe(15000)
    expect(totals.itemCount).toBe(3)
  })
})

describe('готувати вдома vs купити готове', () => {
  const ready = product({ productId: 'cake', name: 'Торт Тірамісу 600 г', price: 34900, promoPrice: 29900, packSize: 600 })

  it('порівняння ведеться за спожитою частиною, а не за цілими упаковками', () => {
    const res = compareCookVsReady({
      missingCost: 45700,
      missingCostConsumed: 27030,
      pantryValue: 8000,
      cookMinutes: 30,
      cookServings: 6,
      readyProduct: ready,
      readyServingsPerPack: 6,
      desiredServings: 6,
    })
    expect(res.recommendation).toBe('cook')
    expect(res.cook.leftoverValue).toBe(18670)
    expect(res.cook.costPerServing).toBe(Math.round(27030 / 6))
    expect(res.explanation).toContain('лишиться')
  })

  it('без спожитої частини поводиться як раніше', () => {
    const res = compareCookVsReady({
      missingCost: 50000,
      pantryValue: 0,
      cookMinutes: 30,
      cookServings: 6,
      readyProduct: ready,
      readyServingsPerPack: 6,
      desiredServings: 6,
    })
    expect(res.cook.leftoverValue).toBe(0)
    expect(res.recommendation).toBe('ready')
  })

  it('без готового аналога рекомендує готувати і каже про це прямо', () => {
    const res = compareCookVsReady({
      missingCost: 20000,
      pantryValue: 0,
      cookMinutes: 30,
      cookServings: 4,
      readyProduct: null,
      readyServingsPerPack: 1,
      desiredServings: 4,
    })
    expect(res.ready).toBeNull()
    expect(res.recommendation).toBe('cook')
    expect(res.explanation).toContain('не знайдено')
  })

  it('близькі ціни дають нічию, а не хибну перевагу', () => {
    const res = compareCookVsReady({
      missingCost: 30000,
      missingCostConsumed: 29000,
      pantryValue: 0,
      cookMinutes: 30,
      cookServings: 6,
      readyProduct: ready,
      readyServingsPerPack: 6,
      desiredServings: 6,
    })
    expect(res.recommendation).toBe('tie')
  })

  it('докуповує потрібну кількість упаковок готового під більшу компанію', () => {
    const res = compareCookVsReady({
      missingCost: 10000,
      pantryValue: 0,
      cookMinutes: 30,
      cookServings: 12,
      readyProduct: ready,
      readyServingsPerPack: 6,
      desiredServings: 12,
    })
    expect(res.ready?.quantity).toBe(2)
    expect(res.ready?.totalCost).toBe(29900 * 2)
  })
})

describe('відбір готових аналогів страви', () => {
  it('приймає торт і тістечко як готовий аналог', () => {
    expect(isPlausibleReadyMeal('Торт «Степанків» «Тірамісу»', 'Тірамісу')).toBe(true)
    expect(isPlausibleReadyMeal('Тістечко Biscotti Тірамісу бісквітне', 'Тірамісу')).toBe(true)
  })

  it('відкидає товари «зі смаком» — це не страва', () => {
    expect(isPlausibleReadyMeal('Шоколад «Світоч» «Десерт» смак тірамісу', 'Тірамісу')).toBe(false)
    expect(isPlausibleReadyMeal('Морозиво Tonitto зі смаком тірамісу з кавовою начинкою', 'Тірамісу')).toBe(false)
  })

  it('відкидає товар, у назві якого страви немає', () => {
    expect(isPlausibleReadyMeal('Сир Маскарпоне 78%', 'Тірамісу')).toBe(false)
  })
})

describe('оцінка порцій у готовому товарі', () => {
  it('тістечко — одна порція, торт — шість', () => {
    expect(estimateServingsPerPack('Тістечко Biscotti Тірамісу бісквітне')).toBe(1)
    expect(estimateServingsPerPack('Торт «Степанків» «Тірамісу»')).toBe(6)
  })

  it('кирилиця розпізнається (regex із \\b тут не працює)', () => {
    // саме на цьому падала попередня реалізація: /\bторт/ ніколи не збігався
    expect(estimateServingsPerPack('Торт Наполеон')).toBeGreaterThan(1)
    expect(estimateServingsPerPack('Чізкейк Нью-Йорк')).toBeGreaterThan(1)
  })

  it('за відомою вагою рахує ~120 г на порцію', () => {
    expect(estimateServingsPerPack('Десерт вагою', 600, 'г')).toBe(5)
  })

  it('невідомий товар — одна порція, без вигадок', () => {
    expect(estimateServingsPerPack('Щось незрозуміле')).toBe(1)
  })

  it('торт на 6 порцій виграє в тістечка попри вищий цінник', () => {
    const cake = { name: 'Торт «Степанків» «Тірамісу»', price: 27900 }
    const pastry = { name: 'Тістечко Biscotti Тірамісу', price: 17400 }
    const perServing = (p: { name: string; price: number }) => p.price / estimateServingsPerPack(p.name)
    expect(perServing(cake)).toBeLessThan(perServing(pastry))
  })
})
