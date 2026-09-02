/**
 * Метрики, які пітч називає вголос: «частка страв, приготованих із наявного;
 * списано вчасно проти викинутого; конверсія з поради в кошик; і скільки
 * родин ведуть комору через місяць».
 *
 * Тут вони рахуються з подій, які застосунок і так пише, — і мовчать, поки
 * подій замало. Це головне правило модуля: «100% страв із наявного» після
 * однієї вечері не метрика, а випадковість, і показувати її означало б
 * видавати демонстрацію за дослідження.
 *
 * Четверта метрика не рахується взагалі, поки немає місяця спостережень.
 * Замість числа стоїть чесне «потрібно ще N днів» — прототип не має права
 * стверджувати про утримання нічого.
 */

/** Скільки подій потрібно, щоб показувати відсоток. */
export const MIN_EVENTS = 3

/** Скільки днів користування потрібно, щоб узагалі говорити про утримання. */
export const RETENTION_DAYS = 30

export interface MetricsInput {
  /** по одній події на приготовану страву */
  cooked: { fromPantry: number; total: number }[]
  /** позиції, що покинули комору: з’їдені проти викинутих */
  disposals: { eaten: number; wasted: number }
  /** пропозиції кошика: скільки показано і скільки підтверджено */
  proposals: { total: number; addedToCart: number }
  /** скільки днів минуло від першої події користувача */
  daysObserved: number
}

export interface MetricCard {
  key: 'cookedFromPantry' | 'eatenInTime' | 'adviceToCart' | 'retention'
  label: string
  /** null — даних замало; вигадувати число не можна */
  value: string | null
  /** що саме порахували або чого бракує */
  hint: string
  enough: boolean
}

function percent(part: number, whole: number): string {
  return `${Math.round((part / whole) * 100)}%`
}

function need(events: number): string {
  const left = MIN_EVENTS - events
  return events === 0
    ? 'Подій поки що немає'
    : `Замало даних: ${events} з ${MIN_EVENTS}, потрібно ще ${left}`
}

export function buildMetrics(input: MetricsInput): MetricCard[] {
  /**
   * Страва без інгредієнтів не бере участі в середньому: ділення на нуль
   * дало б NaN, а «зарахувати як 100%» завищило б показник рівно там, де
   * даних немає взагалі.
   */
  const meals = input.cooked.filter((c) => c.total > 0)
  const cookedEnough = meals.length >= MIN_EVENTS
  const coverage = cookedEnough
    ? meals.reduce((sum, c) => sum + c.fromPantry / c.total, 0) / meals.length
    : 0

  const left = input.disposals.eaten + input.disposals.wasted
  const wasteEnough = left >= MIN_EVENTS

  const proposalsEnough = input.proposals.total >= MIN_EVENTS

  const daysLeft = RETENTION_DAYS - input.daysObserved

  return [
    {
      key: 'cookedFromPantry',
      label: 'Страви з того, що вже вдома',
      value: cookedEnough ? percent(coverage, 1) : null,
      hint: cookedEnough
        ? `Середнє по ${meals.length} приготованих стравах`
        : need(meals.length),
      enough: cookedEnough,
    },
    {
      key: 'eatenInTime',
      label: 'Спожито вчасно, не викинуто',
      value: wasteEnough ? percent(input.disposals.eaten, left) : null,
      hint: wasteEnough
        ? `${input.disposals.eaten} спожито, ${input.disposals.wasted} викинуто`
        : need(left),
      enough: wasteEnough,
    },
    {
      key: 'adviceToCart',
      label: 'Порад дійшло до кошика',
      value: proposalsEnough ? percent(input.proposals.addedToCart, input.proposals.total) : null,
      hint: proposalsEnough
        ? `${input.proposals.addedToCart} із ${input.proposals.total} пропозицій підтверджено`
        : need(input.proposals.total),
      enough: proposalsEnough,
    },
    {
      key: 'retention',
      label: 'Родини, що ведуть комору місяць',
      value: null,
      hint:
        daysLeft > 0
          ? `Рахується від 30 днів користування — потрібно ще ${daysLeft}`
          : 'Потрібні дані кількох родин, а не одного демо-акаунта',
      enough: false,
    },
  ]
}
