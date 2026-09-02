import { describe, it, expect } from 'vitest'
import { buildMetrics, MIN_EVENTS } from '@/lib/domain/metrics'
import { COOKED_SEED, EATEN_SEED, WASTED_SEED, PROPOSALS_SEED } from '@/lib/seed/activity'

/**
 * Метрики, які пітч називає вголос. Головне правило тут — не показувати
 * відсоток, поки подій менше за MIN_EVENTS: «100% страв із наявного» після
 * однієї вечері — це не метрика, а випадковість, і журі це побачить швидше
 * за будь-кого.
 */

const empty = {
  cooked: [],
  disposals: { eaten: 0, wasted: 0 },
  proposals: { total: 0, addedToCart: 0 },
  daysObserved: 0,
}

describe('buildMetrics', () => {
  it('на порожніх даних жодне число не вигадується', () => {
    const m = buildMetrics(empty)
    expect(m.every((x) => x.value === null)).toBe(true)
    expect(m.every((x) => x.enough === false)).toBe(true)
    expect(m[0].hint).toMatch(/поки що немає|замало/i)
  })

  it('одна страва — ще не статистика', () => {
    const m = buildMetrics({ ...empty, cooked: [{ fromPantry: 5, total: 5 }] })
    const cooked = m.find((x) => x.key === 'cookedFromPantry')!
    expect(cooked.enough).toBe(false)
    expect(cooked.value).toBeNull()
    // але кількість подій показуємо чесно: людина має бачити, чого бракує
    expect(cooked.hint).toContain('1')
  })

  it(`з ${MIN_EVENTS} страв рахує частку приготованого з наявного`, () => {
    const m = buildMetrics({
      ...empty,
      cooked: [
        { fromPantry: 5, total: 5 },
        { fromPantry: 3, total: 6 },
        { fromPantry: 2, total: 4 },
      ],
    })
    const cooked = m.find((x) => x.key === 'cookedFromPantry')!
    // (1 + 0.5 + 0.5) / 3 = 0.667
    expect(cooked.enough).toBe(true)
    expect(cooked.value).toBe('67%')
  })

  /**
   * Порожня страва не бере участі ні в середньому, ні в підрахунку подій:
   * якби вона йшла в знаменник як 100%, показник завищувався б рівно там,
   * де даних немає. Тому тут чотири записи, з яких рахуються три.
   */
  it('страва без інгредієнтів не ділить на нуль і не йде в лічильник', () => {
    const m = buildMetrics({
      ...empty,
      cooked: [
        { fromPantry: 0, total: 0 },
        { fromPantry: 2, total: 2 },
        { fromPantry: 1, total: 2 },
        { fromPantry: 3, total: 4 },
      ],
    })
    const cooked = m.find((x) => x.key === 'cookedFromPantry')!
    // (1 + 0,5 + 0,75) / 3 = 0,75
    expect(cooked.value).toBe('75%')
    expect(cooked.hint).toContain('3')
  })

  it('трьох записів, з яких один порожній, для відсотка не вистачає', () => {
    const m = buildMetrics({
      ...empty,
      cooked: [
        { fromPantry: 0, total: 0 },
        { fromPantry: 2, total: 2 },
        { fromPantry: 1, total: 2 },
      ],
    })
    expect(m.find((x) => x.key === 'cookedFromPantry')!.value).toBeNull()
  })

  it('спожите проти викинутого рахується від суми, а не від з’їденого', () => {
    const m = buildMetrics({ ...empty, disposals: { eaten: 9, wasted: 1 } })
    const waste = m.find((x) => x.key === 'eatenInTime')!
    expect(waste.enough).toBe(true)
    expect(waste.value).toBe('90%')
  })

  it('без жодного викинутого 100% — це чесно, якщо подій достатньо', () => {
    const m = buildMetrics({ ...empty, disposals: { eaten: 5, wasted: 0 } })
    expect(m.find((x) => x.key === 'eatenInTime')!.value).toBe('100%')
  })

  it('конверсія поради в кошик рахується від показаних пропозицій', () => {
    const m = buildMetrics({ ...empty, proposals: { total: 8, addedToCart: 6 } })
    const conv = m.find((x) => x.key === 'adviceToCart')!
    expect(conv.value).toBe('75%')
  })

  /**
   * Утримання чесно не рахується: місяця користування в прототипі не було.
   * Показати тут будь-яке число означало б видати демонстрацію за
   * дослідження.
   */
  it('утримання не вигадується навіть за великої кількості подій', () => {
    const m = buildMetrics({
      cooked: Array.from({ length: 40 }, () => ({ fromPantry: 3, total: 4 })),
      disposals: { eaten: 40, wasted: 2 },
      proposals: { total: 30, addedToCart: 20 },
      daysObserved: 7,
    })
    const retention = m.find((x) => x.key === 'retention')!
    expect(retention.value).toBeNull()
    expect(retention.enough).toBe(false)
    expect(retention.hint).toMatch(/30 днів|місяц/i)
  })

  it('за 30+ днів спостереження утримання стає доступним', () => {
    const m = buildMetrics({ ...empty, daysObserved: 31 })
    const retention = m.find((x) => x.key === 'retention')!
    expect(retention.hint).not.toMatch(/потрібно ще/i)
  })

  it('порядок карток фіксований — він повторює порядок у пітчі', () => {
    expect(buildMetrics(empty).map((m) => m.key)).toEqual([
      'cookedFromPantry',
      'eatenInTime',
      'adviceToCart',
      'retention',
    ])
  })
})

describe('сідована історія демо', () => {
  /**
   * Демо має показувати числа, а не чотири прочерки: інакше людина не
   * розуміє, ЩО застосунок міряє. Але числа мають лишатись правдоподібними —
   * 100% скрізь виглядало б як реклама, а не як вимірювання.
   */
  it('сідованої історії досить для трьох метрик, і жодна не ідеальна', () => {
    const m = buildMetrics({
      cooked: COOKED_SEED,
      disposals: { eaten: EATEN_SEED, wasted: WASTED_SEED },
      proposals: { total: PROPOSALS_SEED.length, addedToCart: PROPOSALS_SEED.filter(Boolean).length },
      daysObserved: 14,
    })
    for (const key of ['cookedFromPantry', 'eatenInTime', 'adviceToCart']) {
      const card = m.find((x) => x.key === key)!
      expect(card.enough, `${key} має бути порахованим`).toBe(true)
      expect(card.value).toMatch(/^\d+%$/)
      expect(card.value, `${key}: 100% виглядає як реклама`).not.toBe('100%')
    }
    expect(m.find((x) => x.key === 'retention')!.value).toBeNull()
  })
})
