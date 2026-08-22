import { z } from 'zod'
import { normalizeProductName, canonicalKeys } from './normalize'
import type { CookingTip, RecipeLike, Unit } from './types'

/**
 * Користувацькі рецепти.
 *
 * Ключова відмінність від наших 30 рецептів — рівень довіри до складу.
 * У власних рецептах `normalizedName` виставлений вручну й вивірений;
 * у користувацьких інгредієнт приходить вільним текстом, і нормалізатор
 * помиляється двома способами:
 *
 *   «Арахісова паста» → «арахісова» — невідомий ключ, алергія на арахіс
 *                                      НЕ заблокує страву;
 *   «Молочко кокосове» → «молоко»   — гірше: підміна одного продукту іншим,
 *                                      і фільтр спрацює неправильно в обидва боки.
 *
 * Тому джерелом правди про алергени є ЗАЯВА АВТОРА, а не здогад із тексту.
 * Нерозпізнані інгредієнти позначають рецепт як неперевірений, і це видно
 * користувачу — мовчазна впевненість тут коштувала б чужого здоровʼя.
 */

/** Алергени, які автор може задекларувати. Свідомо короткий список найпоширеніших. */
export const DECLARABLE_ALLERGENS = [
  'глютен',
  'лактоза',
  'молочний білок',
  'яйця',
  'арахіс',
  'горіхи',
  'риба',
  'морепродукти',
  'соя',
  'мед',
  'кунжут',
  'селера',
] as const

export type DeclarableAllergen = (typeof DECLARABLE_ALLERGENS)[number]

const UNITS = ['г', 'кг', 'мл', 'л', 'шт', 'ст.л', 'ч.л'] as const

export const UserIngredientSchema = z.object({
  name: z.string().min(2).max(60),
  quantity: z.number().positive().max(10_000),
  unit: z.enum(UNITS),
})

export const UserStepSchema = z.object({
  text: z.string().min(3).max(400),
  timerMinutes: z.number().int().min(0).max(600).optional(),
})

export const UserTipSchema = z.object({
  kind: z.enum(['technique', 'substitute', 'storage', 'safety', 'kids']),
  text: z.string().min(5).max(300),
})

export const UserRecipeInputSchema = z.object({
  title: z.string().min(3).max(80),
  summary: z.string().min(10).max(200),
  servings: z.number().int().min(1).max(12),
  cookingTime: z.number().int().min(1).max(600),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  cuisine: z.string().min(2).max(40),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'dessert', 'snack']),
  imageEmoji: z.string().min(1).max(8),
  ingredients: z.array(UserIngredientSchema).min(2).max(30),
  steps: z.array(UserStepSchema).min(1).max(20),
  tips: z.array(UserTipSchema).max(10).default([]),
  declaredAllergens: z.array(z.enum(DECLARABLE_ALLERGENS)).max(12).default([]),
  /** автор підтвердив, що склад вказано чесно */
  authorConfirmed: z.literal(true),
})

export type UserRecipeInput = z.infer<typeof UserRecipeInputSchema>

export interface NormalizedIngredient {
  name: string
  normalizedName: string
  quantity: number
  unit: Unit
  /** чи впізнав нормалізатор цей інгредієнт */
  recognized: boolean
}

export interface CompositionCheck {
  ingredients: NormalizedIngredient[]
  unknown: string[]
  /** усі інгредієнти впізнані → фільтр алергенів працює як для наших рецептів */
  verified: boolean
}

/**
 * Нормалізує інгредієнти й чесно каже, скільки з них не впізнано.
 * НЕ намагається вгадати: невпізнаний інгредієнт лишається невпізнаним.
 */
export function checkComposition(ingredients: UserRecipeInput['ingredients']): CompositionCheck {
  const known = new Set(canonicalKeys())
  const unknown: string[] = []

  const normalized = ingredients.map((ing) => {
    const key = normalizeProductName(ing.name)
    const recognized = key.length > 0 && known.has(key)
    if (!recognized) unknown.push(ing.name)
    return {
      name: ing.name,
      normalizedName: recognized ? key : '',
      quantity: ing.quantity,
      unit: ing.unit as Unit,
      recognized,
    }
  })

  return { ingredients: normalized, unknown, verified: unknown.length === 0 }
}

/** URL-безпечний slug із кирилиці. */
export function slugifyTitle(title: string): string {
  const MAP: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z',
    и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
    р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'shch', ь: '', ю: 'iu', я: 'ia', "'": '', 'ʼ': '',
  }
  const base = title
    .toLowerCase()
    .split('')
    .map((ch) => MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || 'recipe'
}

/**
 * Перетворює збережений користувацький рецепт у форму, з якою працює агент.
 *
 * Неперевірені рецепти НЕ потрапляють у скоринг і планування: там від
 * `normalizedName` залежать і матчинг комори, і блокування алергенів.
 * Показати такий рецепт у стрічці можна, покласти в раціон — ні.
 */
export function toRecipeLike(row: {
  id: string
  slug: string
  title: string
  summary: string
  servings: number
  cookingTime: number
  difficulty: string
  cuisine: string
  mealType: string
  ingredients: string
  steps: string
  tips: string
  imageEmoji: string
}): RecipeLike {
  const ingredients = safeJson<NormalizedIngredient[]>(row.ingredients, [])
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    servings: row.servings,
    cookingTime: row.cookingTime,
    difficulty: row.difficulty as RecipeLike['difficulty'],
    cuisine: row.cuisine,
    mealType: row.mealType as RecipeLike['mealType'],
    imageEmoji: row.imageEmoji,
    tags: ['user'],
    nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    ingredients: ingredients.map((i) => ({
      name: i.name,
      normalizedName: i.normalizedName,
      quantity: i.quantity,
      unit: i.unit,
    })),
    steps: safeJson<RecipeLike['steps']>(row.steps, []),
    tips: safeJson<CookingTip[]>(row.tips, []),
  }
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) || typeof parsed === 'object' ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

/**
 * ISO-тиждень у форматі «2026-W32».
 * Потрібен, щоб «рецепт тижня» був саме тижневим, а не «за весь час».
 */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // четвер того самого тижня визначає рік за ISO 8601
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Скільки голосів потрібно, щоб оголошувати переможця тижня. */
export const MIN_VOTES_FOR_WINNER = 3

export interface WeeklyWinner {
  isoWeek: string
  recipeId: string | null
  votes: number
  /** голосів замало — переможця не оголошуємо, а не вдаємо, що він є */
  enoughVotes: boolean
}

export function pickWeeklyWinner(
  tally: { recipeId: string; votes: number }[],
  week: string,
): WeeklyWinner {
  const top = [...tally].sort((a, b) => b.votes - a.votes)[0]
  if (!top) return { isoWeek: week, recipeId: null, votes: 0, enoughVotes: false }
  return {
    isoWeek: week,
    recipeId: top.votes >= MIN_VOTES_FOR_WINNER ? top.recipeId : null,
    votes: top.votes,
    enoughVotes: top.votes >= MIN_VOTES_FOR_WINNER,
  }
}

/**
 * Тиждень людською мовою.
 *
 * «2026-W34» — ключ для бази, а не підпис для людини: щоб зрозуміти, який це
 * тиждень, треба знати стандарт ISO 8601. Для стрічки достатньо сказати,
 * поточний він чи ні, а для минулих — назвати дати.
 */
export function weekLabel(week: string, now: Date): string {
  if (week === isoWeek(now)) return 'цього тижня'
  const m = week.match(/^(\d{4})-W(\d{2})$/)
  if (!m) return week
  const [, year, num] = m
  // четвер визначає тиждень за ISO 8601; від нього рахуємо понеділок і неділю
  const jan4 = new Date(Date.UTC(Number(year), 0, 4))
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (Number(num) - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)
  const fmt = (d: Date) => `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return `${fmt(monday)}–${fmt(sunday)}`
}
