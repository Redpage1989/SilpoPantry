/**
 * Доменні типи. Свідомо відокремлені від Prisma-моделей:
 * доменна логіка має бути чистою і тестованою без бази.
 */

/** Гроші скрізь у копійках (ціле число). Ніяких float-гривень. */
export type Kopiyky = number

export const STORAGE_LOCATIONS = [
  'fridge',
  'freezer',
  'produce',
  'pantry',
  'drinks',
  'snacks',
  'baby',
  'other',
] as const
export type StorageLocation = (typeof STORAGE_LOCATIONS)[number]

export const STORAGE_LABELS: Record<StorageLocation, string> = {
  fridge: 'Холодильник',
  freezer: 'Морозильна камера',
  produce: 'Овочі та фрукти',
  pantry: 'Бакалія',
  drinks: 'Напої',
  snacks: 'Снеки',
  baby: 'Дитяче харчування',
  other: 'Інше',
}

export const PANTRY_SOURCES = [
  'photo',
  'manual',
  'online_order',
  'offline_receipt',
  'previous_cart',
] as const
export type PantrySource = (typeof PANTRY_SOURCES)[number]

export const SOURCE_LABELS: Record<PantrySource, string> = {
  photo: 'Фото',
  manual: 'Додано вручну',
  online_order: 'Онлайн-замовлення',
  offline_receipt: 'Офлайн-чек «Сільпо»',
  previous_cart: 'Попередній кошик',
}

/** Одиниці, з якими працює домен. `pcs` — штуки. */
export type Unit = 'г' | 'кг' | 'мл' | 'л' | 'шт' | 'ст.л' | 'ч.л' | 'пуч' | 'уп'

/**
 * Одиниці, які користувач може обрати для позиції комори.
 * Вужчі за Unit навмисно: «ст.л» і «пуч» — кулінарні міри з рецептів,
 * а «уп» означає «розмір невідомий» і в коморі беззмістовна.
 */
export const PANTRY_UNITS = ['шт', 'г', 'кг', 'мл', 'л'] as const
export type PantryUnit = (typeof PANTRY_UNITS)[number]

/** Зводить будь-яку одиницю до тієї, яку можна зберегти в коморі. */
export function toPantryUnit(unit: Unit): PantryUnit {
  if (unit === 'кг' || unit === 'г') return unit
  if (unit === 'л' || unit === 'мл') return unit
  if (unit === 'шт') return 'шт'
  if (unit === 'ст.л' || unit === 'ч.л') return 'мл'
  if (unit === 'пуч') return 'г'
  // «уп» — розмір упаковки невідомий, тож рахуємо штуками
  return 'шт'
}

export interface PantryEntry {
  id: string
  normalizedName: string
  originalName: string
  category: string
  quantity: number
  unit: Unit
  expiryDate: Date | null
  storageLocation: StorageLocation
  source: PantrySource
  confidence: number
  needsConfirmation: boolean
}

export interface RecipeIngredient {
  name: string
  normalizedName: string
  quantity: number
  unit: Unit
  optional?: boolean
  /** нормалізовані назви допустимих замін */
  substitutes?: string[]
  /**
   * Орієнтовна ціна для оцінки докупівлі, копійки за БАЗОВУ одиницю —
   * г, мл або шт, незалежно від `unit` самого інгредієнта. Саме
   * двозначність слова «одиниця» тут і породила ціну «0,12 грн» за
   * дві столові ложки олії.
   */
  approxPricePerUnit?: Kopiyky
}

export interface RecipeStep {
  step: number
  text: string
  timerMinutes?: number
}

export type Difficulty = 'easy' | 'medium' | 'hard'
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'snack'

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: 'Сніданок',
  lunch: 'Обід',
  dinner: 'Вечеря',
  dessert: 'Десерт',
  snack: 'Перекус',
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Просто',
  medium: 'Середньо',
  hard: 'Складно',
}

/**
 * Порада з приготування.
 *
 * Виділена в окремий тип, бо поради бувають різного призначення:
 * техніка (як не зіпсувати), заміна (чим замінити), зберігання
 * (що робити із залишками — це прямо працює на зменшення відходів)
 * і безпека (де можна нашкодити собі).
 */
export type TipKind = 'technique' | 'substitute' | 'storage' | 'safety' | 'kids'

export interface CookingTip {
  kind: TipKind
  text: string
}

export const TIP_LABELS: Record<TipKind, string> = {
  technique: 'Техніка',
  substitute: 'Заміна',
  storage: 'Зберігання',
  safety: 'Безпека',
  kids: 'Для дітей',
}

export const TIP_EMOJI: Record<TipKind, string> = {
  technique: '👩‍🍳',
  substitute: '🔄',
  storage: '🧊',
  safety: '⚠️',
  kids: '🧒',
}

export interface RecipeLike {
  id: string
  slug: string
  title: string
  summary: string
  servings: number
  cookingTime: number
  difficulty: Difficulty
  cuisine: string
  mealType: MealType
  ingredients: RecipeIngredient[]
  steps: RecipeStep[]
  nutrition: { kcal: number; protein: number; fat: number; carbs: number }
  tags: string[]
  imageEmoji: string
  /** практичні поради саме до цієї страви */
  tips?: CookingTip[]
  /**
   * Алергени, ЗАЯВЛЕНІ автором користувацького рецепта.
   *
   * Для наших 30 рецептів поле порожнє: там склад вивірений вручну, і
   * достатньо самих інгредієнтів. У користувацькому рецепті склад може
   * ховати алерген, якого немає в назві інгредієнта («соус сатай» — це
   * арахіс), тому декларація автора перевіряється НАРІВНІ з інгредієнтами.
   */
  declaredAllergens?: string[]
}

export type RestrictionType = 'allergy' | 'intolerance' | 'diet' | 'dislike' | 'religious'
export type Severity = 'critical' | 'high' | 'medium' | 'low'

export interface Restriction {
  restrictionType: RestrictionType
  /** нормалізований ключ: "арахіс", "лактоза", "vegetarian", "гостре" */
  value: string
  severity: Severity
  memberName?: string
}

export interface HouseholdContext {
  displayName: string
  members: { name: string; type: 'adult' | 'child' | 'teen' | 'senior'; age?: number; preferences: string[] }[]
  restrictions: Restriction[]
  weeklyBudget: Kopiyky | null
  mealsPerDay: number
  maxCookMinutes: number
}

/** Чого не вистачає для страви, з урахуванням наявного та замін. */
export interface MissingIngredient {
  name: string
  normalizedName: string
  needed: number
  have: number
  missing: number
  unit: Unit
  /** повністю відсутній vs частково не вистачає */
  kind: 'absent' | 'insufficient'
  optional: boolean
  /** якщо покрито заміною з комори */
  coveredBySubstitute?: { normalizedName: string; originalName: string }
  approxCost: Kopiyky
}

export interface CoverageResult {
  /** 0..1 — частка обов'язкових інгредієнтів, закритих коморою */
  coverage: number
  have: RecipeIngredient[]
  missing: MissingIngredient[]
  /** нормалізовані назви продуктів комори, які страва «рятує» від псування */
  rescues: string[]
  approxMissingCost: Kopiyky
}

export type ProductTier = 'budget' | 'optimal' | 'premium'

export const TIER_LABELS: Record<ProductTier, string> = {
  budget: 'Бюджетний',
  optimal: 'Оптимальний',
  premium: 'Преміальний',
}

export interface ProductOption {
  productId: string
  companyId?: string
  /** slug потрібен для silpo_get_product_details — сервер не приймає id */
  slug?: string
  /** філія, з якої доступний товар; обовʼязкова при додаванні в кошик */
  branchId?: string
  /** ваговий товар: кількість задається кроком, а не штуками */
  weighted?: boolean
  /** чи є в наявності в обраній філії */
  inStock?: boolean
  name: string
  brand?: string
  price: Kopiyky
  promoPrice?: Kopiyky
  unit: Unit
  packSize: number
  rating?: number
  tier?: ProductTier
  /** із MCP: перелік алергенів/складу, якщо доступний */
  allergens?: string[]
}
