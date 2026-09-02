import { describe, it, expect } from 'vitest'
import {
  checkComposition,
  slugifyTitle,
  isoWeek,
  pickWeeklyWinner,
  MIN_VOTES_FOR_WINNER,
  UserRecipeInputSchema,
  weekLabel,
} from '@/lib/domain/user-recipes'
import { COMMUNITY_RECIPES } from '@/lib/seed/community'
import { checkRecipeAgainstRestrictions } from '@/lib/domain/restrictions'
import type { RecipeLike, Restriction } from '@/lib/domain/types'

/**
 * Головне, що тут перевіряється, — НЕ зручність, а безпека.
 *
 * Користувацький рецепт приходить вільним текстом, і нормалізатор
 * помиляється двома способами. Обидва відтворені нижче як тести,
 * бо саме вони роблять фільтр алергенів ненадійним.
 */

describe('перевірка складу користувацького рецепта', () => {
  it('впізнає знайомі інгредієнти', () => {
    const res = checkComposition([
      { name: 'Молоко', quantity: 200, unit: 'мл' },
      { name: 'Яйця', quantity: 2, unit: 'шт' },
    ])
    expect(res.verified).toBe(true)
    expect(res.unknown).toEqual([])
    expect(res.ingredients.every((i) => i.recognized)).toBe(true)
  })

  it('НЕ вгадує невідомий інгредієнт, а позначає його', () => {
    // «Арахісова паста» → «арахісова»: алергія на арахіс не спрацює
    const res = checkComposition([
      { name: 'Молоко', quantity: 200, unit: 'мл' },
      { name: 'Арахісова паста', quantity: 50, unit: 'г' },
    ])
    expect(res.verified).toBe(false)
    expect(res.unknown).toContain('Арахісова паста')
    const peanut = res.ingredients.find((i) => i.name === 'Арахісова паста')!
    expect(peanut.recognized).toBe(false)
    // порожній ключ, а не хибний: краще нічого, ніж «арахісова»
    expect(peanut.normalizedName).toBe('')
  })

  it('позначає рецепт неперевіреним, якщо хоч один інгредієнт невідомий', () => {
    const res = checkComposition([
      { name: 'Борошно', quantity: 200, unit: 'г' },
      { name: 'Тофу', quantity: 100, unit: 'г' },
      { name: 'Цукор', quantity: 50, unit: 'г' },
    ])
    expect(res.verified).toBe(false)
    expect(res.unknown).toEqual(['Тофу'])
  })

  it('фіксує відому пастку: кокосове молоко зводиться до коровʼячого', () => {
    // Це НЕ бажана поведінка, а задокументований дефект нормалізатора.
    // Саме через нього декларація алергенів робиться автором, а не здогадом.
    const res = checkComposition([{ name: 'Молочко кокосове', quantity: 200, unit: 'мл' }])
    expect(res.verified).toBe(true)
    expect(res.ingredients[0].normalizedName).toBe('молоко')
  })
})

describe('декларація алергенів — джерело правди', () => {
  const recipe = (keys: string[]): RecipeLike => ({
    id: 'u1',
    slug: 'u1',
    title: 'Користувацька страва',
    summary: '',
    servings: 2,
    cookingTime: 20,
    difficulty: 'easy',
    cuisine: 'Українська',
    mealType: 'dinner',
    imageEmoji: '🍽️',
    tags: ['user'],
    nutrition: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
    ingredients: keys.map((k) => ({ name: k, normalizedName: k, quantity: 100, unit: 'г' as const })),
    steps: [],
  })

  const peanutAllergy: Restriction[] = [
    { restrictionType: 'allergy', value: 'арахіс', severity: 'critical' },
  ]

  it('невпізнаний інгредієнт НЕ блокується автоматично — саме тому потрібна декларація', () => {
    // порожній normalizedName означає, що фільтр про нього нічого не знає
    const check = checkRecipeAgainstRestrictions(recipe(['']), peanutAllergy)
    expect(check.result).not.toBe('blocked')
    // але попередження про алергію в родині лишається завжди
    expect(check.allergyNotice).toBeTruthy()
  })

  it('коли інгредієнт впізнано, фільтр працює як для наших рецептів', () => {
    const check = checkRecipeAgainstRestrictions(recipe(['арахіс']), peanutAllergy)
    expect(check.result).toBe('blocked')
  })
})

describe('slug із кирилиці', () => {
  it('дає читабельний латинський slug', () => {
    expect(slugifyTitle('Борщ український')).toBe('borshch-ukrainskyi')
    expect(slugifyTitle('Сирники з ізюмом')).toBe('syrnyky-z-iziumom')
  })

  it('не лишає порожнього значення', () => {
    expect(slugifyTitle('!!!')).toBe('recipe')
    expect(slugifyTitle('')).toBe('recipe')
  })

  it('обрізає надто довгу назву', () => {
    expect(slugifyTitle('а'.repeat(200)).length).toBeLessThanOrEqual(60)
  })
})

describe('ISO-тиждень', () => {
  it('рахує тиждень за ISO 8601', () => {
    expect(isoWeek(new Date(2026, 0, 1))).toBe('2026-W01')
    expect(isoWeek(new Date(2026, 7, 6))).toBe('2026-W32')
  })

  it('дні одного тижня дають однаковий ключ', () => {
    const mon = isoWeek(new Date(2026, 7, 3))
    const sun = isoWeek(new Date(2026, 7, 9))
    expect(mon).toBe(sun)
  })

  it('наступний понеділок — уже інший тиждень', () => {
    expect(isoWeek(new Date(2026, 7, 3))).not.toBe(isoWeek(new Date(2026, 7, 10)))
  })
})

describe('рецепт тижня', () => {
  it('не оголошує переможця, коли голосів замало', () => {
    const res = pickWeeklyWinner([{ recipeId: 'a', votes: MIN_VOTES_FOR_WINNER - 1 }], '2026-W32')
    expect(res.enoughVotes).toBe(false)
    expect(res.recipeId).toBeNull()
    // кількість усе одно показуємо — це чесніше за «переможця немає»
    expect(res.votes).toBe(MIN_VOTES_FOR_WINNER - 1)
  })

  it('оголошує переможця, коли голосів достатньо', () => {
    const res = pickWeeklyWinner(
      [
        { recipeId: 'a', votes: 2 },
        { recipeId: 'b', votes: MIN_VOTES_FOR_WINNER },
      ],
      '2026-W32',
    )
    expect(res.recipeId).toBe('b')
    expect(res.enoughVotes).toBe(true)
  })

  it('порожній тиждень не ламає підрахунок', () => {
    const res = pickWeeklyWinner([], '2026-W32')
    expect(res.recipeId).toBeNull()
    expect(res.votes).toBe(0)
  })
})

describe('валідація форми рецепта', () => {
  const valid = {
    title: 'Тестова страва',
    summary: 'Опис страви достатньої довжини',
    servings: 2,
    cookingTime: 30,
    difficulty: 'easy' as const,
    cuisine: 'Українська',
    mealType: 'dinner' as const,
    imageEmoji: '🍲',
    ingredients: [
      { name: 'Молоко', quantity: 200, unit: 'мл' as const },
      { name: 'Яйця', quantity: 2, unit: 'шт' as const },
    ],
    steps: [{ text: 'Змішати все' }],
    tips: [],
    declaredAllergens: ['лактоза' as const],
    authorConfirmed: true as const,
  }

  it('приймає коректний рецепт', () => {
    expect(UserRecipeInputSchema.safeParse(valid).success).toBe(true)
  })

  it('вимагає щонайменше два інгредієнти й один крок', () => {
    expect(UserRecipeInputSchema.safeParse({ ...valid, ingredients: [valid.ingredients[0]] }).success).toBe(false)
    expect(UserRecipeInputSchema.safeParse({ ...valid, steps: [] }).success).toBe(false)
  })

  it('без підтвердження автора рецепт не приймається', () => {
    expect(UserRecipeInputSchema.safeParse({ ...valid, authorConfirmed: false }).success).toBe(false)
  })

  it('відхиляє алерген поза списком — вільний текст тут неприпустимий', () => {
    expect(
      UserRecipeInputSchema.safeParse({ ...valid, declaredAllergens: ['щось своє'] }).success,
    ).toBe(false)
  })
})

/**
 * Підпис тижня для людини.
 *
 * «2026-W34» — ключ для бази. Щоб зрозуміти, який це тиждень, треба знати
 * ISO 8601; у стрічці рецептів це вимога не за адресою.
 */
describe('людський підпис тижня', () => {
  it('поточний тиждень називає словами, а не кодом', () => {
    const now = new Date(2026, 7, 12)
    expect(weekLabel(isoWeek(now), now)).toBe('цього тижня')
  })

  it('минулий тиждень називає датами', () => {
    const now = new Date(2026, 7, 12)
    expect(weekLabel('2026-W32', now)).toBe('3.08–9.08')
  })

  it('пошкоджений ключ повертає як є, а не вигадує дати', () => {
    expect(weekLabel('казна-що', new Date(2026, 7, 12))).toBe('казна-що')
  })
})

describe('стартова стрічка спільноти', () => {
  /**
   * Склад кожного рецепта має розпізнаватись повністю. Інакше
   * `compositionVerified` буде false: рецепт з'явиться у стрічці з
   * попередженням, а агент не візьме страву в підбір — тобто розділ, який
   * ми заповнюємо заради першого враження, це враження й зіпсує.
   */
  it('усі інгредієнти впізнані нормалізатором', () => {
    for (const r of COMMUNITY_RECIPES) {
      const c = checkComposition(r.ingredients)
      expect(c.unknown, `${r.title}: не впізнано ${c.unknown.join(', ')}`).toEqual([])
      expect(c.verified).toBe(true)
    }
  })

  it('рецепти проходять ту саму схему, що й публікація людиною', () => {
    for (const r of COMMUNITY_RECIPES) {
      const parsed = UserRecipeInputSchema.safeParse({ ...r, authorConfirmed: true })
      expect(parsed.success, `${r.title}: ${parsed.error?.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`).toBe(true)
    }
  })

  it('є рецепт із трьома голосами — інакше переможець тижня не оголошується', () => {
    const top = Math.max(...COMMUNITY_RECIPES.map((r) => r.votedBy.length))
    expect(top).toBeGreaterThanOrEqual(MIN_VOTES_FOR_WINNER)
  })

  it('ніхто не голосує за власний рецепт і голоси не дублюються', () => {
    for (const r of COMMUNITY_RECIPES) {
      expect(r.votedBy).not.toContain(r.authorId)
      expect(new Set(r.votedBy).size).toBe(r.votedBy.length)
    }
  })
})
