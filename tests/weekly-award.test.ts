import { describe, it, expect } from 'vitest'
import {
  isWeekClosed,
  buildAwardRequest,
  resolveTie,
  weekStart,
  prizeBalabonuses,
  AWARD_STATUS_LABELS,
} from '@/lib/domain/weekly-award'
import { isoWeek, MIN_VOTES_FOR_WINNER } from '@/lib/domain/user-recipes'

/**
 * Приз перетворює голосування з розваги на щось, що варто накрутити.
 * Тому перевіряється не «чи є переможець», а чи не можна отримати нагороду
 * раніше або двічі.
 */

const MON = new Date(2026, 7, 3) // понеділок 2026-W32
const WED = new Date(2026, 7, 5)
const NEXT_MON = new Date(2026, 7, 10) // 2026-W33

describe('закритість тижня', () => {
  it('поточний тиждень НЕ закритий — голосування ще триває', () => {
    expect(isWeekClosed(isoWeek(WED), WED)).toBe(false)
  })

  it('минулий тиждень закритий', () => {
    expect(isWeekClosed(isoWeek(WED), NEXT_MON)).toBe(true)
  })

  it('понеділок 00:00 уже належить новому тижню', () => {
    expect(isoWeek(NEXT_MON)).not.toBe(isoWeek(WED))
    expect(isWeekClosed(isoWeek(WED), NEXT_MON)).toBe(true)
  })

  it('weekStart дає понеділок для будь-якого дня тижня', () => {
    for (const d of [MON, WED, new Date(2026, 7, 9)]) {
      const start = weekStart(d)
      expect(start.getDay()).toBe(1)
      expect(start.getHours()).toBe(0)
    }
  })
})

describe('заявка на нагородження', () => {
  const candidate = { isoWeek: '2026-W32', userRecipeId: 'r1', authorId: 'a1', votes: 5 }

  it('не створюється, поки тиждень триває — інакше приз можна забрати достроково', () => {
    const res = buildAwardRequest(candidate, WED)
    expect(res.request).toBeNull()
    expect('reason' in res && res.reason).toBe('week_open')
  })

  it('не створюється, якщо голосів менше порога', () => {
    const res = buildAwardRequest({ ...candidate, votes: MIN_VOTES_FOR_WINNER - 1 }, NEXT_MON)
    expect(res.request).toBeNull()
    expect('reason' in res && res.reason).toBe('not_enough_votes')
  })

  it('створюється для закритого тижня зі статусом «очікує»', () => {
    const res = buildAwardRequest(candidate, NEXT_MON)
    expect(res.request).not.toBeNull()
    expect(res.request!.status).toBe('pending')
    expect(res.request!.prizeBalabonuses).toBe(prizeBalabonuses())
    expect(res.request!.authorId).toBe('a1')
  })

  it('нарахування ніколи не позначається виконаним нашим боком', () => {
    // «pending» — єдиний стартовий стан: балабонуси нараховує «Сільпо»,
    // у MCP немає інструмента запису лояльності
    const res = buildAwardRequest(candidate, NEXT_MON)
    expect(res.request!.status).not.toBe('granted')
    expect(AWARD_STATUS_LABELS.pending).toContain('Сільпо')
  })
})

describe('нічия', () => {
  const at = (day: number) => new Date(2026, 7, day)

  it('виграє рецепт, опублікований раніше', () => {
    const winner = resolveTie([
      { recipeId: 'new', authorId: 'a', votes: 4, createdAt: at(5) },
      { recipeId: 'old', authorId: 'b', votes: 4, createdAt: at(1) },
    ])
    expect(winner!.recipeId).toBe('old')
  })

  it('більше голосів завжди важливіше за давність', () => {
    const winner = resolveTie([
      { recipeId: 'old', authorId: 'b', votes: 3, createdAt: at(1) },
      { recipeId: 'new', authorId: 'a', votes: 9, createdAt: at(5) },
    ])
    expect(winner!.recipeId).toBe('new')
  })

  it('порядок вхідних даних не впливає на результат', () => {
    const rows = [
      { recipeId: 'a', authorId: 'x', votes: 4, createdAt: at(2) },
      { recipeId: 'b', authorId: 'y', votes: 4, createdAt: at(2) },
    ]
    const first = resolveTie(rows)!.recipeId
    expect(resolveTie([...rows].reverse())!.recipeId).toBe(first)
  })

  it('порожній тиждень не дає переможця', () => {
    expect(resolveTie([])).toBeNull()
  })
})

describe('розмір призу', () => {
  it('має розумний дефолт і завжди додатний', () => {
    expect(prizeBalabonuses()).toBeGreaterThan(0)
    expect(Number.isInteger(prizeBalabonuses())).toBe(true)
  })
})
