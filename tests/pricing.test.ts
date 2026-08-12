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
  cartQuantity,
  isBelowWeightMinimum,
  weightedStepPrice,
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

/**
 * Вагові товари. Дві різні речі, які легко сплутати:
 *
 *   1. СКІЛЬКИ брати — мінімальна покупка дорівнює кроку ваги САМОГО товару;
 *      єдиної межі для каталогу немає. У живому «Сільпо» 06.08.2026
 *      зустрічались кроки 50, 100, 200, 250, 300 і 500 г.
 *   2. В ЧОМУ надсилати — схема `add_or_update_cart_products` вимагає для
 *      вагових товарів кілограми, кратні кроку, а не лічильник кроків.
 *
 * Друге коштувало реальних грошей: два кроки сиру по 200 г їхали в кошик
 * як `quantity: 2`, і «Сільпо» розуміло це як 2 кг замість 0,4 кг.
 */
describe('вагові товари: крок ваги з каталогу і одиниця кількості', () => {
  const weighed = (stepGrams: number) =>
    product({ productId: 'w', packSize: stepGrams, unit: 'г', weighted: true })

  // кроки, реально зустрінуті в каталозі «Сільпо»
  const REAL_STEPS = [50, 100, 200, 250, 300, 500]

  it('мінімум дорівнює кроку товару, а не спільному числу', () => {
    for (const step of REAL_STEPS) {
      // рецепту треба 20 г — беремо рівно один крок, яким би він не був
      expect(packsNeeded(20, 'г', weighed(step))).toBe(1)
      expect(cartQuantity(weighed(step), 1)).toBeCloseTo(step / 1000, 5)
    }
  })

  it('20 г пармезану неможливо замовити — мінімум задає крок сиру', () => {
    const parmesan = weighed(200)
    expect(packsNeeded(20, 'г', parmesan)).toBe(1)
    expect(cartQuantity(parmesan, 1)).toBe(0.2)
    expect(isBelowWeightMinimum(20, 'г', parmesan)).toBe(true)
  })

  it('потреба більша за крок — округлюємо вгору до цілих кроків', () => {
    expect(packsNeeded(500, 'г', weighed(100))).toBe(5)
    expect(packsNeeded(510, 'г', weighed(100))).toBe(6)
    expect(packsNeeded(250, 'г', weighed(50))).toBe(5)
  })

  it('у кошик іде вага в кілограмах, а не кількість кроків', () => {
    // саме тут ховалась помилка: раніше надсилали 2 → «Сільпо» читало 2 кг
    expect(cartQuantity(weighed(200), 2)).toBe(0.4)
    expect(cartQuantity(weighed(250), 3)).toBe(0.75)
    expect(cartQuantity(weighed(100), 3)).toBe(0.3) // не 0.30000000000000004
    expect(cartQuantity(weighed(50), 1)).toBe(0.05)
  })

  it('кількість для кошика завжди кратна кроку — цього вимагає схема', () => {
    for (const step of REAL_STEPS) {
      for (const packs of [1, 2, 3, 7]) {
        const kg = cartQuantity(weighed(step), packs)
        const stepsInside = (kg * 1000) / step
        expect(Math.abs(stepsInside - Math.round(stepsInside))).toBeLessThan(1e-6)
      }
    }
  })

  it('штучний товар лишається штучним: кількість упаковок як є', () => {
    const packaged = product({ productId: 'p', packSize: 200, unit: 'г' })
    expect(cartQuantity(packaged, 2)).toBe(2)
    expect(packsNeeded(20, 'г', packaged)).toBe(1)
    expect(isBelowWeightMinimum(20, 'г', packaged)).toBe(false)
  })

  it('позначка про мінімум зникає, коли потреба перевищила крок', () => {
    expect(isBelowWeightMinimum(500, 'г', weighed(100))).toBe(false)
    expect(isBelowWeightMinimum(99, 'г', weighed(100))).toBe(true)
  })

  it('несумісні одиниці не дають вигаданої ваги', () => {
    // рецепт у мілілітрах, товар ваговий у грамах — рахувати нічого
    expect(packsNeeded(30, 'мл', weighed(100))).toBe(1)
    expect(isBelowWeightMinimum(30, 'мл', weighed(100))).toBe(false)
  })
})

/**
 * Ціна вагового товару.
 *
 * «Сільпо» показує її за 100 г — не за кілограм і не за крок ваги. Перевірено
 * на живому каталозі 12.08.2026 на товарах різних цінових рівнів: інакше
 * пекоріно романо коштувало б 19,90 грн/кг, а це неможливо.
 *
 * Решта застосунку вважає `price` ціною однієї упаковки, тому перерахунок
 * робиться один раз при мапінгу відповіді MCP.
 */
describe('ціна вагового товару за 100 г', () => {
  it('крок 100 г — ціна не змінюється', () => {
    expect(weightedStepPrice(1990, 100)).toBe(1990)
  })

  it('крок 200 г — ціна подвоюється', () => {
    // Beemster козячий: 19,99 за 100 г → 39,98 за крок 200 г
    expect(weightedStepPrice(1999, 200)).toBe(3998)
  })

  it('крок 50 г — половина ціни', () => {
    expect(weightedStepPrice(1990, 50)).toBe(995)
  })

  it('крок 500 г — пʼять разів по 100 г', () => {
    expect(weightedStepPrice(449, 500)).toBe(2245)
  })

  it('результат лишається цілим числом копійок', () => {
    for (const [per100, step] of [[1299, 250], [899, 300], [449, 50], [1999, 250]]) {
      const v = weightedStepPrice(per100, step)
      expect(Number.isInteger(v)).toBe(true)
    }
  })

  it('крок 0 не ламає розрахунок', () => {
    expect(weightedStepPrice(1990, 0)).toBe(1990)
  })

  it('реальні товари дають правдоподібну ціну за кілограм', () => {
    // якби ціна була за кг, пекоріно романо коштувало б 19,90 грн/кг
    const perKg = (per100: number, step: number) => (weightedStepPrice(per100, step) / step) * 1000 / 100
    expect(perKg(1990, 100)).toBeCloseTo(199, 1) // пекоріно романо, грн/кг
    expect(perKg(1999, 200)).toBeCloseTo(199.9, 1) // Beemster козячий
    expect(perKg(449, 100)).toBeCloseTo(44.9, 1) // бекон запечений
  })
})
