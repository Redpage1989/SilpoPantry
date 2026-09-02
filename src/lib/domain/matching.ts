import type {
  CoverageResult,
  MissingIngredient,
  PantryEntry,
  RecipeIngredient,
  RecipeLike,
  Kopiyky,
} from './types'
import { areUnitsCompatible, toBase, convert } from './units'
import { normalizeProductName, transliterateLatinFoodTerms } from './normalize'
import { daysUntil, SOON_DAYS } from './pantry'

/** Орієнтовна ціна одиниці, коли рецепт її не задав (копійки за г/мл/шт). */
const FALLBACK_PRICE_PER_BASE_UNIT: Record<string, Kopiyky> = {
  'яйця': 700, // за штуку
  'молоко': 5, // за мл
  'вершки': 12,
  'маскарпоне': 60,
  'масло вершкове': 40,
  'сир твердий': 45,
  'савоярді': 50,
  'кава': 60,
  'какао': 55,
  'цукор': 4,
  'борошно': 3,
  'макарони': 8,
  'помідори': 9,
  'шпинат': 30,
  'куряче філе': 25,
}

const DEFAULT_PRICE_PER_BASE_UNIT: Kopiyky = 15

/**
 * Ціна завжди задана за БАЗОВУ одиницю (копійка за г / мл / шт) — і своя
 * в рецепті, і запасна з таблиці вище. Тому кількість переводиться в базову
 * ОДИН раз, спільно для обох.
 *
 * Доти гілка з власною ціною множила на кількість у одиниці інгредієнта.
 * Для г, мл і шт це те саме число, тож помилка не проявлялась — але олія
 * «2 ст.л» коштувала 6 × 2 = 12 копійок замість 6 × 30 мл = 1,80 грн, і
 * саме цей рядок стояв на головному екрані демонстрації: «докупити
 * ≈ 0,12 грн». Ложка, кілограм, літр і пучок помилялись у 15, 1000, 1000
 * і 40 разів відповідно.
 */
function approxCostFor(ing: RecipeIngredient, missingQty: number): Kopiyky {
  const perBase = ing.approxPricePerUnit ?? FALLBACK_PRICE_PER_BASE_UNIT[ing.normalizedName] ?? DEFAULT_PRICE_PER_BASE_UNIT
  return Math.round(perBase * toBase(missingQty, ing.unit))
}

/**
 * Головна функція матчингу: що з рецепта вже є вдома, а чого не вистачає.
 *
 * Правила, які тут закодовані:
 *  · необовʼязкові інгредієнти не впливають на coverage і не блокують готування;
 *  · заміна з комори закриває потребу, але це показується користувачу явно;
 *  · часткова нестача («треба 200 г, є 120 г») — окремий стан `insufficient`,
 *    бо докупити 80 г ≠ докупити 200 г, і це прямо впливає на суму кошика;
 *  · несумісні одиниці не змішуються (див. units.convert).
 */
export function calculateMissingIngredients(
  recipe: RecipeLike,
  pantry: PantryEntry[],
  options: { servings?: number; now?: Date } = {},
): CoverageResult {
  const now = options.now ?? new Date()
  const multiplier = options.servings ? options.servings / recipe.servings : 1

  const have: RecipeIngredient[] = []
  const missing: MissingIngredient[] = []
  const rescues = new Set<string>()

  // локальний облік, щоб один продукт не «закрив» два різні інгредієнти
  const remaining = new Map<string, number>()
  for (const item of pantry) {
    remaining.set(item.id, item.quantity)
  }

  let requiredCount = 0
  let coveredScore = 0

  for (const raw of recipe.ingredients) {
    const ing: RecipeIngredient = { ...raw, quantity: raw.quantity * multiplier }
    const isRequired = !ing.optional
    if (isRequired) requiredCount += 1

    const substituteKeys = (ing.substitutes ?? []).map((s) => s.toLowerCase())
    const candidates = pantry
      .filter(
        (p) =>
          (p.normalizedName === ing.normalizedName || substituteKeys.includes(p.normalizedName)) &&
          areUnitsCompatible(p.unit, ing.unit) &&
          (remaining.get(p.id) ?? 0) > 0,
      )
      .sort((a, b) => {
        // спершу прямий збіг, потім найближчий термін придатності
        const directA = a.normalizedName === ing.normalizedName ? 0 : 1
        const directB = b.normalizedName === ing.normalizedName ? 0 : 1
        if (directA !== directB) return directA - directB
        const da = a.expiryDate ? daysUntil(a.expiryDate, now) : 9999
        const db = b.expiryDate ? daysUntil(b.expiryDate, now) : 9999
        return da - db
      })

    let neededBase = toBase(ing.quantity, ing.unit)
    let usedSubstitute: MissingIngredient['coveredBySubstitute']

    for (const item of candidates) {
      if (neededBase <= 0.0001) break
      const availableBase = toBase(remaining.get(item.id)!, item.unit)
      const take = Math.min(neededBase, availableBase)
      if (take <= 0) continue
      const takeInItemUnit = convert(take, baseUnitOf(item.unit), item.unit)
      remaining.set(item.id, remaining.get(item.id)! - takeInItemUnit)
      neededBase -= take
      if (item.normalizedName !== ing.normalizedName) {
        usedSubstitute = { normalizedName: item.normalizedName, originalName: item.originalName }
      }
      if (item.expiryDate && daysUntil(item.expiryDate, now) <= SOON_DAYS) {
        rescues.add(item.normalizedName)
      }
    }

    const neededTotalBase = toBase(ing.quantity, ing.unit)
    const usedBase = neededTotalBase - Math.max(0, neededBase)
    const fraction = neededTotalBase === 0 ? 1 : usedBase / neededTotalBase

    if (neededBase <= 0.0001) {
      have.push(ing)
      if (isRequired) coveredScore += 1
    } else {
      if (isRequired) coveredScore += fraction
      const missingQty = round2(convert(neededBase, baseUnitOf(ing.unit), ing.unit))
      missing.push({
        name: ing.name,
        normalizedName: ing.normalizedName,
        needed: round2(ing.quantity),
        have: round2(ing.quantity - missingQty),
        missing: missingQty,
        unit: ing.unit,
        kind: usedBase > 0.0001 ? 'insufficient' : 'absent',
        optional: !!ing.optional,
        coveredBySubstitute: usedSubstitute,
        approxCost: approxCostFor(ing, missingQty),
      })
    }
  }

  const coverage = requiredCount === 0 ? 1 : clamp01(coveredScore / requiredCount)
  const approxMissingCost = missing
    .filter((m) => !m.optional)
    .reduce((sum, m) => sum + m.approxCost, 0)

  return { coverage, have, missing, rescues: [...rescues], approxMissingCost }
}

function baseUnitOf(unit: string): 'г' | 'мл' | 'шт' {
  if (unit === 'шт') return 'шт'
  if (unit === 'г' || unit === 'кг' || unit === 'пуч') return 'г'
  return 'мл'
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Форми, які означають ІНШИЙ продукт, а не інгредієнт.
 *
 * Слово відсіює товар лише тоді, коли самого інгредієнта воно не стосується:
 * для «шоколад» товар із «шоколадний» цілком доречний, для «яйця» — ні.
 */
const NOT_AN_INGREDIENT = [
  'шоколад',
  'цукерк',
  'батончик',
  'драже',
  'морозиво',
  'лікер',
  'напій',
  'плитка',
  'сироп',
]

/**
 * Входження з межами слова, безпечне для кирилиці.
 *
 * `\b` у JS-регулярках працює лише з ASCII і НІКОЛИ не збігається перед
 * кирилицею — ця пастка вже тричі кусала цей репозиторій. Тому межі
 * перевіряються вручну: символи навколо збігу не мають бути літерами.
 * Без цього bare-ключ «сир» із рецепта спільноти матчив «Сирок глазурований».
 */
const CYR_LETTER = /[а-щьюяїієґa-z0-9]/i
export function includesWord(haystack: string, needle: string): boolean {
  let from = 0
  while (true) {
    const i = haystack.indexOf(needle, from)
    if (i === -1) return false
    const before = i === 0 ? '' : haystack[i - 1]
    const after = i + needle.length >= haystack.length ? '' : haystack[i + needle.length]
    if (!CYR_LETTER.test(before) && !CYR_LETTER.test(after)) return true
    from = i + 1
  }
}

/**
 * Чи схожий товар на сам інгредієнт, а не на солодощі з його назвою.
 *
 * Усі приклади в логіці — з живих прогонів, не вигадані:
 *   «Яйця» → «Молоко пастеризоване» (чорний список не ловить — потрібна
 *   позитивна перевірка), «Маскарпоне» → «Тістечко Макарон» (пошук «Сільпо»
 *   знаходить за схожістю), «Сир твердий» → «Сир Гауда» (ключ товару «сир»
 *   не дорівнює багатослівному ключу інгредієнта, але Є одним із його слів).
 */
export function isPlausibleIngredientMatch(productName: string, ingredientName: string): boolean {
  // латиниця з етикетки → кирилиця, інакше кириличний ключ «маскарпоне»
  // не знаходився в назві «Сир Mascarpone Galbani» і товар випадав з рівнів
  const name = transliterateLatinFoodTerms(productName.toLowerCase())
  const ingredient = ingredientName.toLowerCase()

  // «зі смаком X» — ароматизований продукт, а не сам X
  if (name.includes('смак') && !ingredient.includes('смак')) return false
  if (NOT_AN_INGREDIENT.some((w) => name.includes(w) && !ingredient.includes(w))) return false

  const key = normalizeProductName(ingredientName)
  if (key.length === 0) return true

  const prodKey = normalizeProductName(productName)
  if (prodKey === key) return true

  /**
   * Багатослівний ключ інгредієнта: товар доречний, коли його власний ключ —
   * одне зі слів ключа. «Сир Гауда» (ключ «сир») для «сир твердий».
   * Рівність цілим словом, не підрядком: «сирок» ∉ {«сир», «твердий»}.
   *
   * Асиметрія навмисна. Збіг із ПЕРШИМ словом достатній сам по собі: перше
   * слово — це тип продукту («сир …»). Збіг із дальшим словом вимагає ще й
   * сліду першого слова в назві, інакше «Філе лосося» проходило б для
   * «куряче філе» — філе, але не те. Слід шукається за основою слова
   * («куряче» → «куря» знаходить і «курячої»), бо закінчення в кирилиці
   * змінюються за відмінками.
   */
  if (key.includes(' ')) {
    const words = key.split(' ')
    if (words[0] === prodKey) return true
    if (words.includes(prodKey)) {
      const stem = words[0].slice(0, Math.max(4, words[0].length - 2))
      if (name.includes(stem)) return true
    }
  }
  return includesWord(name, key)
}

export function isPlausibleReadyMeal(productName: string, dishTitle: string): boolean {
  const name = productName.toLowerCase()
  const dish = dishTitle.toLowerCase()
  if (!name.includes(dish.split(' ')[0])) return false
  // «зі смаком X» — це ароматизований продукт, а не сама страва
  if (name.includes('смак')) return false
  const NOT_A_DISH = ['шоколад', 'морозиво', 'напій', 'сироп', 'кава', 'йогурт', 'печиво', 'батончик', 'цукерк']
  return !NOT_A_DISH.some((w) => name.includes(w))
}
