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
  pricePerHundred,
} from '@/lib/domain/pricing'
import { isPlausibleReadyMeal, isPlausibleIngredientMatch } from '@/lib/agent/tools'

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
 * «Сільпо» дає її за КІЛОГРАМ, а кількість у кошику — теж у кілограмах.
 * Калібровано за арифметикою самого кошика (12.08.2026):
 *   персик  price 84.99 · quantity 0.4 · subTotal 34      → 84,99 × 0,4 кг
 *   кавун   price 39.99 · quantity 5   · subTotal 199.95  → 39,99 × 5 кг
 * Той самий персик у пошуку має рівно те саме `price: 84.99`, тож формат
 * однаковий для каталогу й кошика.
 */
describe('ціна вагового товару за кілограм', () => {
  it('крок 1 кг — ціна не змінюється', () => {
    expect(weightedStepPrice(8499, 1000)).toBe(8499)
  })

  it('відтворює арифметику реального кошика', () => {
    // персик: 84,99 грн/кг, крок 400 г → 34,00 грн за крок
    expect(weightedStepPrice(8499, 400)).toBe(3400)
    // кавун: 39,99 грн/кг, крок 5 кг → 199,95 грн за крок
    expect(weightedStepPrice(3999, 5000)).toBe(19995)
  })

  it('крок 100 г — десята частина ціни за кілограм', () => {
    expect(weightedStepPrice(19900, 100)).toBe(1990)
  })

  it('крок 200 г — пʼята частина', () => {
    expect(weightedStepPrice(19990, 200)).toBe(3998)
  })

  it('результат лишається цілим числом копійок', () => {
    for (const [perKg, step] of [[12999, 250], [8999, 300], [4499, 50], [19999, 250]]) {
      expect(Number.isInteger(weightedStepPrice(perKg, step))).toBe(true)
    }
  })

  it('крок 0 не ламає розрахунок', () => {
    expect(weightedStepPrice(19900, 0)).toBe(19900)
  })
})

/**
 * Формат сум від «Сільпо».
 *
 * Усі суми приходять у ГРИВНЯХ — і цілим числом, і дробовим. Евристика
 * «ціле число більше 1000 — це вже копійки» ділила на 100 ціну кожного
 * товару, дорожчого за 1000 грн.
 */
describe('переведення цін «Сільпо» у копійки', () => {
  // та сама функція, що в live-adapter: суми завжди в гривнях
  const toKopiyky = (v: number) => Math.round(v * 100)

  it('дробові гривні', () => {
    expect(toKopiyky(84.99)).toBe(8499)
    expect(toKopiyky(1.49)).toBe(149)
    expect(toKopiyky(199.95)).toBe(19995)
  })

  it('цілі гривні — теж гривні, а не копійки', () => {
    expect(toKopiyky(274)).toBe(27400)
    expect(toKopiyky(139)).toBe(13900)
  })

  it('дорогі товари не дешевшають у сто разів', () => {
    // віскі за 6499 грн раніше показувалось як 64,99 грн
    expect(toKopiyky(6499)).toBe(649900)
    expect(toKopiyky(1990)).toBe(199000)
    expect(toKopiyky(1001)).toBe(100100)
  })

  it('немає розриву навколо 1000', () => {
    for (const v of [999, 1000, 1001, 1500]) {
      expect(toKopiyky(v)).toBe(v * 100)
    }
  })
})

/**
 * Рівні цін при змішаних вимірах.
 *
 * Пошук «сир твердий» у живому каталозі повертає і вагові товари (`г`), і
 * фасовані без ваги в каталозі (`уп`). Ділення ціни на packSize = 1 давало
 * «ціну за упаковку», більшу за ціну за грам у сотні разів, — тому фасований
 * товар завжди опинявся «преміальним», а ваговий «бюджетним».
 */
describe('рівні цін не плутають виміри', () => {
  const need = missing({
    name: 'Сир твердий',
    normalizedName: 'сир твердий',
    needed: 200,
    have: 0,
    missing: 200,
    unit: 'г',
  })

  const weighedCheese = product({
    productId: 'w',
    name: 'Сир ваговий',
    packSize: 200,
    unit: 'г',
    weighted: true,
    price: 3998, // 39,98 грн за 200 г
  })
  const packagedCheap = product({
    productId: 'p-cheap',
    name: 'Сир фасований дешевий',
    packSize: 1,
    unit: 'уп',
    price: 8900, // 89,00 грн
  })
  const packagedDear = product({
    productId: 'p-dear',
    name: 'Сир фасований дорогий',
    packSize: 1,
    unit: 'уп',
    price: 24900, // 249,00 грн
  })

  it('при змішаних вимірах рівні впорядковані за реальною ціною', () => {
    const tiers = buildTiers([packagedDear, weighedCheese, packagedCheap], need)
    const budget = tiers.find((t) => t.tier === 'budget')!
    const premium = tiers.find((t) => t.tier === 'premium')!
    // 39,98 < 89,00 < 249,00 — саме так, а не «ваговий завжди найдешевший»
    expect(budget.product.productId).toBe('w')
    expect(premium.product.productId).toBe('p-dear')
    expect(budget.lineTotal).toBeLessThan(premium.lineTotal)
  })

  it('дорогий ваговий товар не стає бюджетним лише тому, що він ваговий', () => {
    const pricyWeighed = { ...weighedCheese, productId: 'w2', price: 60000 } // 600 грн за 200 г
    const tiers = buildTiers([pricyWeighed, packagedCheap, packagedDear], need)
    expect(tiers.find((t) => t.tier === 'budget')!.product.productId).toBe('p-cheap')
    expect(tiers.find((t) => t.tier === 'premium')!.product.productId).toBe('w2')
  })

  it('коли виміри однакові, порівняння лишається за базовою одиницею', () => {
    const small = product({ productId: 's', packSize: 100, unit: 'г', price: 3000 }) // 30 грн/100 г
    const big = product({ productId: 'b', packSize: 500, unit: 'г', price: 10000 }) // 20 грн/100 г
    const tiers = buildTiers([small, big], need)
    // велика упаковка вигідніша за грам, хоч і дорожча загалом
    expect(tiers.find((t) => t.tier === 'budget')!.product.productId).toBe('b')
  })

  it('пояснення не обіцяє «за 100 г», коли виміри змішані', () => {
    const tiers = buildTiers([weighedCheese, packagedCheap], need)
    expect(tiers.find((t) => t.tier === 'budget')!.rationale).not.toContain('100 г')
  })
})

/**
 * Релевантність товару інгредієнту.
 *
 * Каталог «Сільпо» шукає за входженням слова, тому на «Яйця» повертає
 * шоколадне яйце з сюрпризом. Усі приклади нижче взяті з живого прогону
 * сценарію «тірамісу» 12.08.2026 — це не вигадані випадки.
 */
describe('товар має бути самим інгредієнтом, а не солодощами з його назвою', () => {
  it('відсіює ароматизовані продукти', () => {
    expect(isPlausibleIngredientMatch('Десерт Bonjour зі смаком чорниці та маскарпоне', 'Маскарпоне')).toBe(false)
    expect(isPlausibleIngredientMatch('Напій кавовий Nescafe Tiramisu зі смаком', 'Кава мелена')).toBe(false)
  })

  it('відсіює кондитерські форми', () => {
    expect(isPlausibleIngredientMatch('Яйце шоколадне The Smurfs із сюрпризом', 'Яйця')).toBe(false)
    expect(isPlausibleIngredientMatch('Какао-плитка Millano Spolka', 'Какао')).toBe(false)
    expect(isPlausibleIngredientMatch('Лікер Baileys Tiramisu', 'Кава мелена')).toBe(false)
  })

  it('лишає справжні інгредієнти', () => {
    expect(isPlausibleIngredientMatch("Сир Ghidetti «Маскарпоне» 45% з коров'ячого молока", 'Маскарпоне')).toBe(true)
    expect(isPlausibleIngredientMatch('Яйця курячі Ситий двір С2', 'Яйця')).toBe(true)
    expect(isPlausibleIngredientMatch('Какао-порошок «Добрик» темний', 'Какао')).toBe(true)
    expect(isPlausibleIngredientMatch('Цукор «Премія»® білий пресований', 'Цукор')).toBe(true)
    expect(isPlausibleIngredientMatch('Печиво «Премія»® Савоярді', 'Печиво савоярді')).toBe(true)
  })

  it('не відсіює слово, яке є в самому інгредієнті', () => {
    // для шоколаду «шоколадний» — доречно, для яєць — ні
    expect(isPlausibleIngredientMatch('Шоколад молочний Roshen', 'Шоколад')).toBe(true)
    expect(isPlausibleIngredientMatch('Морозиво пломбір', 'Морозиво')).toBe(true)
    expect(isPlausibleIngredientMatch('Сироп кленовий', 'Сироп')).toBe(true)
  })
})

/**
 * Питома ціна — те, за чим рівні впорядковані насправді.
 *
 * Живий приклад із демо: маскарпоне «Преміальний» 159 грн виглядав дешевшим
 * за «Оптимальний» 279 грн. Помилки в розрахунку не було — різні фасовки
 * (250 г проти 500 г), — але ярлики про це не казали.
 */
describe('ціна за 100 г робить порядок рівнів видимим', () => {
  it('пояснює, чому дорожчий рівень має менший підсумок', () => {
    const optimal = product({ productId: 'o', packSize: 500, unit: 'г', price: 27900 })
    const premium = product({ productId: 'p', packSize: 250, unit: 'г', price: 15900 })
    // підсумок преміального менший…
    expect(effectivePrice(premium)).toBeLessThan(effectivePrice(optimal))
    // …а питома ціна — більша, і саме за нею він преміальний
    expect(pricePerHundred(premium)!).toBeGreaterThan(pricePerHundred(optimal)!)
    expect(pricePerHundred(optimal)).toBe(5580)
    expect(pricePerHundred(premium)).toBe(6360)
  })

  it('враховує акційну ціну, а не перекреслену', () => {
    const onSale = product({ productId: 's', packSize: 250, unit: 'г', price: 18900, promoPrice: 15900 })
    expect(pricePerHundred(onSale)).toBe(6360)
  })

  it('рахує для обʼєму так само', () => {
    expect(pricePerHundred(product({ productId: 'v', packSize: 1, unit: 'л', price: 9000 }))).toBe(900)
  })

  it('не вигадує питомої ціни, коли ваги упаковки немає', () => {
    expect(pricePerHundred(product({ productId: 'u', packSize: 1, unit: 'уп', price: 12900 }))).toBeNull()
    expect(pricePerHundred(product({ productId: 'c', packSize: 10, unit: 'шт', price: 5000 }))).toBeNull()
  })

  it('преміальний більше не обіцяє якості, якої не вимірює', () => {
    const need = missing({ name: 'Сир', normalizedName: 'сир', needed: 200, have: 0, missing: 200, unit: 'г' })
    const tiers = buildTiers(
      [
        product({ productId: 'a', packSize: 500, unit: 'г', price: 10000 }),
        product({ productId: 'b', packSize: 400, unit: 'г', price: 12000 }),
        product({ productId: 'c', packSize: 250, unit: 'г', price: 15900 }),
      ],
      need,
    )
    const premium = tiers.find((t) => t.tier === 'premium')!
    expect(premium.rationale).not.toContain('якість')
    expect(premium.rationale).toContain('100 г')
  })
})
