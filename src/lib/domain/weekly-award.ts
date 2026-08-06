import { MIN_VOTES_FOR_WINNER, isoWeek } from './user-recipes'

/**
 * Нагорода за рецепт тижня.
 *
 * Що тут важливо розуміти: застосунок НЕ може нарахувати балабонуси сам.
 * Серед 39 інструментів MCP «Сільпо» всі лояльнісні (`silpo_get_loyalty_info`,
 * `silpo_get_my_coupons`, `silpo_get_my_promos`) — на читання. Запису бонусів
 * не існує, і вигадувати його означало б показати користувачу приз, якого
 * ніхто не нарахує.
 *
 * Тому наша частина роботи закінчується на підготовці:
 *   · чесно й незворотно зафіксувати переможця тижня,
 *   · сформувати заявку на нагородження зі статусом «очікує»,
 *   · показати цей статус як є, без обіцянок.
 *
 * Коли «Сільпо» відкриє нарахування — зміниться лише перехід статусу,
 * не модель даних і не інтерфейс.
 */

export type AwardStatus = 'pending' | 'granted' | 'declined'

export const AWARD_STATUS_LABELS: Record<AwardStatus, string> = {
  pending: 'очікує нарахування «Сільпо»',
  granted: 'нараховано',
  declined: 'відхилено',
}

/**
 * Розмір призу. Значення — пропозиція з боку застосунку, а не зобовʼязання
 * «Сільпо», і саме так воно підписане в інтерфейсі. Виноситься в env, щоб
 * організатор міг задати власне число, не чіпаючи код.
 */
export function prizeBalabonuses(): number {
  const raw = process.env.WEEKLY_PRIZE_BALABONUSES
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 500
}

export interface AwardCandidate {
  isoWeek: string
  userRecipeId: string
  authorId: string
  votes: number
}

export interface AwardRequest extends AwardCandidate {
  prizeBalabonuses: number
  status: AwardStatus
}

/** Понеділок 00:00 того тижня, до якого належить дата. */
export function weekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayNum = d.getDay() || 7
  d.setDate(d.getDate() - (dayNum - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

/**
 * Чи тиждень уже завершився.
 *
 * Нагороджувати за поточний тиждень не можна: голосування ще відкрите, і
 * «переможець» у вівторок — це не переможець, а тимчасовий лідер. Той, хто
 * побачив би нарахування достроково, мав би привід накрутити голоси під
 * кінець тижня. Тому заявка створюється лише для закритих тижнів.
 */
export function isWeekClosed(week: string, now: Date): boolean {
  return week !== isoWeek(now)
}

/**
 * Формує заявку на нагородження або пояснює, чому її ще немає.
 *
 * Свідомо повертає причину замість `null`: «переможця немає» і «тиждень ще
 * триває» — різні стани, і користувачу треба показувати різне.
 */
export function buildAwardRequest(
  candidate: AwardCandidate,
  now: Date,
): { request: AwardRequest } | { request: null; reason: 'week_open' | 'not_enough_votes' } {
  if (!isWeekClosed(candidate.isoWeek, now)) return { request: null, reason: 'week_open' }
  if (candidate.votes < MIN_VOTES_FOR_WINNER) return { request: null, reason: 'not_enough_votes' }
  return {
    request: {
      ...candidate,
      prizeBalabonuses: prizeBalabonuses(),
      status: 'pending',
    },
  }
}

/**
 * Обирає переможця з підсумків тижня.
 *
 * Нічия розводиться за часом першої публікації: раніший рецепт виграє.
 * Це довільне, але детерміноване правило — важливо, щоб один і той самий
 * тиждень завжди давав ту саму відповідь, інакше «зафіксований» переможець
 * мінявся б від запиту до запиту.
 *
 * Останній критерій — id — не косметика. Двох рецептів з однаковою кількістю
 * голосів і однаковим `createdAt` достатньо, щоб порівняння повернуло 0, а
 * `sort` зберіг вхідний порядок. Порядок рядків із бази без явного ORDER BY
 * не гарантований, тож переможець залежав би від того, як база вирішила
 * повернути рядки цього разу.
 */
export function resolveTie(
  tally: { recipeId: string; authorId: string; votes: number; createdAt: Date }[],
): { recipeId: string; authorId: string; votes: number } | null {
  const sorted = [...tally].sort(
    (a, b) =>
      b.votes - a.votes ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.recipeId.localeCompare(b.recipeId),
  )
  const top = sorted[0]
  return top ? { recipeId: top.recipeId, authorId: top.authorId, votes: top.votes } : null
}
