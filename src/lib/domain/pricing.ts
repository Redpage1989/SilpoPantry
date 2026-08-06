import type { Kopiyky, MissingIngredient, ProductOption, ProductTier, Unit } from './types'
import { toBase, areUnitsCompatible } from './units'
import { formatUah, pluralize } from './scoring'

export { formatUah, pluralize }

/** Ефективна ціна: акційна, якщо вона є і вона нижча. */
export function effectivePrice(p: ProductOption): Kopiyky {
  if (p.promoPrice !== undefined && p.promoPrice > 0 && p.promoPrice < p.price) return p.promoPrice
  return p.price
}

/**
 * Скільки упаковок треба, щоб покрити потребу (упаковку не ділять).
 *
 * Якщо виміри несумісні (рецепт у мл, товар у грамах) — не рахуємо
 * псевдочисло, а чесно повертаємо одну упаковку: краще недооцінити,
 * ніж покласти людині в кошик 2 пачки кави замість однієї.
 */
export function packsNeeded(missingQty: number, missingUnit: Unit, pack: ProductOption): number {
  if (!areUnitsCompatible(missingUnit, pack.unit)) return 1
  const needBase = toBase(missingQty, missingUnit)
  const packBase = toBase(pack.packSize, pack.unit)
  if (packBase <= 0) return 1
  return Math.max(1, Math.ceil(needBase / packBase))
}

/**
 * Яку частину куплених упаковок страва реально спожиє.
 * Решта лишається вдома й не є витратою «на цю страву» —
 * без цього порівняння «готувати vs купити готове» завжди
 * програвало б через пачку кави на 250 г заради 30 г.
 */
export function consumedFraction(missingQty: number, missingUnit: Unit, pack: ProductOption, packs: number): number {
  if (!areUnitsCompatible(missingUnit, pack.unit)) return 1
  const needBase = toBase(missingQty, missingUnit)
  const boughtBase = toBase(pack.packSize, pack.unit) * packs
  if (boughtBase <= 0) return 1
  return Math.max(0, Math.min(1, needBase / boughtBase))
}

/** Ціна за базову одиницю (копійки за г/мл/шт) — для чесного порівняння упаковок. */
export function pricePerBaseUnit(p: ProductOption): number {
  const base = toBase(p.packSize, p.unit)
  return base > 0 ? effectivePrice(p) / base : effectivePrice(p)
}

export interface TieredOption {
  tier: ProductTier
  product: ProductOption
  quantity: number
  lineTotal: Kopiyky
  /** економія відносно звичайної ціни через акцію */
  promoSaving: Kopiyky
  /** вартість тієї частини упаковки, яку страва справді спожиє */
  consumedValue: Kopiyky
  /** вартість залишку, який лишиться вдома на потім */
  leftoverValue: Kopiyky
  rationale: string
}

/**
 * Ділить знайдені товари на три рівні: бюджетний / оптимальний / преміальний.
 *
 * Бюджетний  — найнижча ціна за базову одиницю.
 * Преміальний — найвища ціна за базову одиницю.
 * Оптимальний — найкраще співвідношення рейтингу до ціни; за відсутності
 *               рейтингу — медіана за ціною, а не «щось посередині списку».
 */
export function buildTiers(options: ProductOption[], missing: MissingIngredient): TieredOption[] {
  if (options.length === 0) return []
  const withUnitPrice = options
    .map((p) => ({ p, unitPrice: pricePerBaseUnit(p) }))
    .sort((a, b) => a.unitPrice - b.unitPrice)

  const cheapest = withUnitPrice[0].p
  const priciest = withUnitPrice[withUnitPrice.length - 1].p

  /**
   * «Оптимальний» шукаємо серед варіантів, що НЕ збіглися з бюджетним
   * і преміальним. Інакше три рівні часто зводились до двох, і селектор
   * показував однакову ціну для «Бюджетного» й «Оптимального».
   */
  const middle = withUnitPrice.filter(
    (x) => x.p.productId !== cheapest.productId && x.p.productId !== priciest.productId,
  )
  const pool = middle.length > 0 ? middle : withUnitPrice
  const best = pool.reduce((acc, cur) => {
    const score = (cur.p.rating ?? 4) / Math.max(1, cur.unitPrice)
    const accScore = (acc.p.rating ?? 4) / Math.max(1, acc.unitPrice)
    return score > accScore ? cur : acc
  }).p

  const pick: { tier: ProductTier; product: ProductOption; rationale: string }[] = [
    {
      tier: 'budget',
      product: cheapest,
      // якщо ваги упаковки каталог не дав — не вигадуємо «за 100 г»
      rationale: cheapest.unit === 'уп' ? 'Найнижча ціна серед знайдених' : 'Найнижча ціна за 100 г/мл серед знайдених',
    },
    {
      tier: 'optimal',
      product: best,
      rationale: best.rating ? `Найкраще співвідношення ціни та оцінки (${best.rating}★)` : 'Збалансований варіант за ціною',
    },
    { tier: 'premium', product: priciest, rationale: 'Преміальний варіант — вища якість або бренд' },
  ]

  // якщо варіантів менше трьох — не вигадуємо дублікати
  const seen = new Set<string>()
  const unique = pick.filter((x) => {
    if (seen.has(x.product.productId)) return false
    seen.add(x.product.productId)
    return true
  })

  return unique.map(({ tier, product, rationale }) => {
    const quantity = packsNeeded(missing.missing, missing.unit, product)
    const unitEffective = effectivePrice(product)
    const lineTotal = unitEffective * quantity
    const fraction = consumedFraction(missing.missing, missing.unit, product, quantity)
    const consumedValue = Math.round(lineTotal * fraction)
    return {
      tier,
      product: { ...product, tier },
      quantity,
      lineTotal,
      promoSaving: Math.max(0, (product.price - unitEffective) * quantity),
      consumedValue,
      leftoverValue: lineTotal - consumedValue,
      rationale,
    }
  })
}

export interface BasketTotals {
  subtotal: Kopiyky
  promoSaving: Kopiyky
  total: Kopiyky
  itemCount: number
}

export function sumBasket(lines: { lineTotal: Kopiyky; promoSaving: Kopiyky; quantity: number }[]): BasketTotals {
  const subtotal = lines.reduce((s, l) => s + l.lineTotal + l.promoSaving, 0)
  const promoSaving = lines.reduce((s, l) => s + l.promoSaving, 0)
  return {
    subtotal,
    promoSaving,
    total: subtotal - promoSaving,
    itemCount: lines.reduce((s, l) => s + l.quantity, 0),
  }
}

/**
 * Скільки порцій дає готовий товар.
 *
 * Каталог «Сільпо» не повертає ані ваги, ані кількості порцій, тому це
 * свідома евристика за типом виробу — інакше агент порівнював би
 * «6 тістечок по 174 грн» з домашнім тортом і давав абсурдну суму.
 * Евристика показується користувачу текстом, а не ховається в коді.
 */
export function estimateServingsPerPack(name: string, packSize?: number, unit?: Unit): number {
  const n = name.toLowerCase()
  // Навмисно без regex із \b: межа слова в JS працює за ASCII, тому
  // шаблон «\bторт» ніколи не збігається з кирилицею. Простий includes надійніший.
  const SINGLE = ['тістечк', 'піроженк', 'порці', 'стакан', 'кекс', 'капкейк', 'еклер']
  const SHARED = ['торт', 'пиріг', 'чізкейк', 'рулет']
  if (SINGLE.some((w) => n.includes(w))) return 1
  if (SHARED.some((w) => n.includes(w))) return 6
  // якщо вага відома — рахуємо з розрахунку ~120 г на порцію десерту
  if (packSize && unit === 'г' && packSize >= 200) return Math.max(1, Math.round(packSize / 120))
  return 1
}

export interface CookVsReadyResult {
  cook: {
    ingredientsCost: Kopiyky
    /** вартість продуктів, які вже вдома (не витрачаємо гроші, але витрачаємо ресурс) */
    pantryValue: Kopiyky
    /** скільки треба заплатити зараз — цілими упаковками */
    totalCost: Kopiyky
    /** вартість тієї частини покупки, яку страва справді спожиє */
    consumedCost: Kopiyky
    /** залишок упаковок, що лишиться вдома на наступні страви */
    leftoverValue: Kopiyky
    minutes: number
    servings: number
    costPerServing: Kopiyky
  }
  ready: {
    product: ProductOption
    quantity: number
    totalCost: Kopiyky
    minutes: number
    servings: number
    costPerServing: Kopiyky
  } | null
  /** що рекомендуємо і чому — простою мовою */
  recommendation: 'cook' | 'ready' | 'tie'
  explanation: string
  savingIfCook: Kopiyky
  minutesSavedIfReady: number
}

/**
 * Порівняння «приготувати вдома» vs «купити готове».
 *
 * Важлива чесність: при готуванні вдома ми рахуємо ГРОШІ, які треба витратити
 * (тобто лише докупівлю), і окремо показуємо вартість продуктів із комори —
 * вони вже куплені, і вдавати, що вони безкоштовні, теж було б неправильно.
 */
export function compareCookVsReady(params: {
  missingCost: Kopiyky
  /** вартість спожитої частини; якщо не задано — дорівнює missingCost */
  missingCostConsumed?: Kopiyky
  pantryValue: Kopiyky
  cookMinutes: number
  cookServings: number
  readyProduct: ProductOption | null
  readyServingsPerPack: number
  desiredServings: number
  /** хвилини на дорогу/очікування доставки готового */
  readyMinutes?: number
}): CookVsReadyResult {
  const {
    missingCost,
    pantryValue,
    cookMinutes,
    cookServings,
    readyProduct,
    readyServingsPerPack,
    desiredServings,
    readyMinutes = 0,
  } = params
  const consumedCost = params.missingCostConsumed ?? missingCost

  const cookTotal = missingCost
  const cook = {
    ingredientsCost: missingCost,
    pantryValue,
    totalCost: cookTotal,
    consumedCost,
    leftoverValue: Math.max(0, cookTotal - consumedCost),
    minutes: cookMinutes,
    servings: cookServings,
    // порція рахується за спожитою частиною: решта пачки лишається вдома
    costPerServing: cookServings > 0 ? Math.round(consumedCost / cookServings) : consumedCost,
  }

  if (!readyProduct) {
    return {
      cook,
      ready: null,
      recommendation: 'cook',
      explanation: 'Готового аналога в каталозі не знайдено — маємо лише варіант приготувати вдома.',
      savingIfCook: 0,
      minutesSavedIfReady: 0,
    }
  }

  const packs = Math.max(1, Math.ceil(desiredServings / Math.max(1, readyServingsPerPack)))
  const readyTotal = effectivePrice(readyProduct) * packs
  const readyServings = packs * readyServingsPerPack
  const ready = {
    product: readyProduct,
    quantity: packs,
    totalCost: readyTotal,
    minutes: readyMinutes,
    servings: readyServings,
    costPerServing: readyServings > 0 ? Math.round(readyTotal / readyServings) : readyTotal,
  }

  // Порівнюємо по спожитій частині: інакше пачка кави на 250 г заради 30 г
  // назавжди перемагала б на користь готового десерту, що неправда.
  const diff = readyTotal - consumedCost
  const minutesSaved = cookMinutes - readyMinutes
  const recommendation: CookVsReadyResult['recommendation'] =
    Math.abs(diff) < 2000 ? 'tie' : diff > 0 ? 'cook' : 'ready'

  const leftoverNote =
    cook.leftoverValue > 0
      ? ` Заплатити треба ${formatUah(cookTotal)}, але ${formatUah(cook.leftoverValue)} лишиться у вигляді продуктів на потім.`
      : ''

  const explanation =
    recommendation === 'cook'
      ? `Приготувати вдома дешевше на ${formatUah(diff)} (${formatUah(cook.costPerServing)} проти ${formatUah(ready.costPerServing)} за порцію), але займе ${minutesSaved} хв вашого часу.${leftoverNote}`
      : recommendation === 'ready'
        ? `Готовий варіант дешевший на ${formatUah(-diff)} і економить ${minutesSaved} хв — вигідніше купити.${leftoverNote}`
        : `Різниця в ціні незначна (${formatUah(Math.abs(diff))}). Питання лише в часі: вдома — ${cookMinutes} хв, готове — одразу.${leftoverNote}`

  return { cook, ready, recommendation, explanation, savingIfCook: Math.max(0, diff), minutesSavedIfReady: minutesSaved }
}
