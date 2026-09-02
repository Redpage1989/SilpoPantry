import { allergensImpliedBy } from './restrictions'
import { DECLARABLE_ALLERGENS } from './user-recipes'
import type { NormalizedIngredient } from './user-recipes'

/**
 * Модерація рецептів спільноти.
 *
 * Публікація була миттєвою, і на питання «що заважає викласти будь-що»
 * відповіді не було. Тут вона з'являється, але свідомо вузька: блокує лише
 * те, що можна довести кодом. Здогадки на кшталт «текст виглядає підозріло»
 * не блокують нічого — хибне відхилення живого рецепта коштує дорожче за
 * пропущений, а лайка й дурість ловляться скаргами вже після публікації.
 *
 * Що НЕ перевіряється і чому:
 *
 *  · Правдивість кроків. «Смажте 40 хвилин» може бути помилкою, а може —
 *    задумом; код цього не розрізнить.
 *  · Лайка за списком слів. Список або дірявий, або ловить «часник» у
 *    складі слова. Для цього є скарги.
 *  · Плагіат. Порівнювати з усім інтернетом прототип не може, а порівняння
 *    між своїми рецептами вже робить унікальний slug.
 */

export type IssueSeverity = 'block' | 'warn'

export interface ModerationIssue {
  code: 'undeclared_allergen' | 'contacts' | 'thin_steps' | 'unknown_ingredients'
  severity: IssueSeverity
  /** формулювання для автора: що не так і що з цим робити */
  message: string
}

export interface ModerationVerdict {
  status: 'published' | 'draft'
  issues: ModerationIssue[]
}

export interface ModeratedRecipe {
  title: string
  summary: string
  steps: { text: string }[]
  tips: { kind: string; text: string }[]
  ingredients: NormalizedIngredient[]
  declaredAllergens: string[]
  unknownIngredients: string[]
}

/** Скільки різних людей мають поскаржитись, щоб рецепт зник зі стрічки. */
export const REPORTS_TO_HIDE = 3

/**
 * Мінімальна сумарна довжина опису кроків.
 *
 * Не кількість кроків: «Змішати. Смажити.» — це два кроки, за якими нічого
 * не приготувати. Поріг у 120 символів відсіює саме заглушки, а не короткі
 * чесні рецепти на три речення.
 */
const MIN_STEPS_LENGTH = 120

/**
 * Ознаки контактів і реклами. Шукаємо не «підозрілі слова», а конкретні
 * форми: адресу сайту, @нік, номер телефону, пошту. Рецепт їх не потребує,
 * а спам без них не працює.
 */
const CONTACT_PATTERNS: RegExp[] = [
  /https?:\/\/\S+/i,
  /\b(?:www\.|t\.me\/|telegram\.me\/|instagram\.com\/|facebook\.com\/)\S+/i,
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i,
  /(?<![\w+])@[a-z0-9._]{3,}/i,
  /\+?\d[\d\s().-]{8,}\d/,
]

function collectText(r: ModeratedRecipe): string {
  return [r.title, r.summary, ...r.steps.map((s) => s.text), ...r.tips.map((t) => t.text)].join('\n')
}

export function moderateRecipe(recipe: ModeratedRecipe): ModerationVerdict {
  const issues: ModerationIssue[] = []

  /**
   * Алергени — єдина перевірка, за якою стоїть безпека, а не порядок.
   * На заявленому списку тримається фільтр для родин з алергіями: якщо в
   * складі є яйця, а автор їх не заявив, застосунок покаже страву дитині
   * з алергією. Тому список звіряється з розпізнаним складом.
   *
   * Порівнюємо лише з тими алергенами, які автор МОЖЕ заявити: вимагати
   * декларацію того, чого немає у формі, було б пасткою.
   */
  const recognized = recipe.ingredients.filter((i) => i.recognized).map((i) => i.normalizedName)
  const declarable = new Set<string>(DECLARABLE_ALLERGENS)
  const declared = new Set(recipe.declaredAllergens)
  const missing = allergensImpliedBy(recognized).filter((a) => declarable.has(a) && !declared.has(a))
  if (missing.length > 0) {
    issues.push({
      code: 'undeclared_allergen',
      severity: 'block',
      message:
        `У складі є ${missing.join(', ')} — позначте це в алергенах. ` +
        'Саме за цим списком застосунок ховає страву від родин з алергією.',
    })
  }

  const text = collectText(recipe)
  if (CONTACT_PATTERNS.some((re) => re.test(text))) {
    issues.push({
      code: 'contacts',
      severity: 'block',
      message: 'Приберіть посилання, нікнейми, пошту чи номер телефону — стрічка рецептів не для оголошень.',
    })
  }

  const stepsLength = recipe.steps.reduce((n, s) => n + s.text.trim().length, 0)
  if (stepsLength < MIN_STEPS_LENGTH) {
    issues.push({
      code: 'thin_steps',
      severity: 'block',
      message: 'Опишіть приготування докладніше: за такими кроками страву не повторити.',
    })
  }

  if (recipe.unknownIngredients.length > 0) {
    issues.push({
      code: 'unknown_ingredients',
      severity: 'warn',
      message:
        `Не вдалося розпізнати: ${recipe.unknownIngredients.join(', ')}. ` +
        'Рецепт опублікуємо, але агент не братиме його в підбір, бо не може звірити склад із коморою.',
    })
  }

  const blocked = issues.some((i) => i.severity === 'block')
  return { status: blocked ? 'draft' : 'published', issues }
}

/** Чи ховати рецепт зі стрічки за кількістю скарг від різних людей. */
export function shouldHide(reports: number): boolean {
  return reports >= REPORTS_TO_HIDE
}
