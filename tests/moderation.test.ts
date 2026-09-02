import { describe, it, expect } from 'vitest'
import { moderateRecipe, REPORTS_TO_HIDE, shouldHide } from '@/lib/domain/moderation'

/**
 * Модерація рецептів спільноти.
 *
 * Правило, за яким тут усе побудовано: блокує лише те, що можна довести
 * кодом. Здогадки на кшталт «текст виглядає підозріло» лишаються авторові,
 * бо хибне відхилення живого рецепта коштує дорожче за пропущений.
 */

const base = {
  title: 'Сирники з родзинками',
  summary: 'Сніданок на двадцять хвилин із того, що майже завжди є в холодильнику.',
  steps: [
    { text: 'Родзинки залийте окропом на п’ять хвилин і відкиньте на сито.' },
    { text: 'Сир розімніть виделкою з яйцем, додайте борошно й родзинки.' },
    { text: 'Смажте на невеликому вогні під кришкою по чотири хвилини з боку.' },
  ],
  tips: [{ kind: 'technique' as const, text: 'Під кришкою прогріваються всередині й не лишаються сирими.' }],
  ingredients: [
    { name: 'Сир кисломолочний', normalizedName: 'сир кисломолочний', quantity: 400, unit: 'г' as const, recognized: true },
    { name: 'Яйця', normalizedName: 'яйця', quantity: 1, unit: 'шт' as const, recognized: true },
    { name: 'Борошно', normalizedName: 'борошно', quantity: 60, unit: 'г' as const, recognized: true },
  ],
  declaredAllergens: ['яйця', 'глютен', 'молочний білок', 'лактоза'],
  unknownIngredients: [] as string[],
}

describe('moderateRecipe', () => {
  it('чесний рецепт публікується одразу', () => {
    const v = moderateRecipe(base)
    expect(v.status).toBe('published')
    expect(v.issues.filter((i) => i.severity === 'block')).toEqual([])
  })

  /**
   * Головна перевірка: на заявлених алергенах тримається фільтр для родин
   * з алергіями. Якщо в складі є яйця, а автор їх не заявив, застосунок
   * покаже страву дитині з алергією — і це не помилка інтерфейсу, а
   * наслідок незаповненого поля.
   */
  it('не пропускає незаявлений алерген', () => {
    const v = moderateRecipe({ ...base, declaredAllergens: ['глютен'] })
    expect(v.status).toBe('draft')
    const issue = v.issues.find((i) => i.code === 'undeclared_allergen')!
    expect(issue.severity).toBe('block')
    expect(issue.message).toContain('яйця')
  })

  it('зайвий заявлений алерген не блокує: автор має право перестрахуватись', () => {
    const v = moderateRecipe({ ...base, declaredAllergens: [...base.declaredAllergens, 'горіхи'] })
    expect(v.status).toBe('published')
  })

  it.each([
    ['посилання', 'Більше рецептів на https://example.com'],
    ['телеграм', 'Пишіть у телеграм @my_recipes'],
    ['телефон', 'Замовляйте торти: +380671234567'],
  ])('не пропускає контакти в тексті (%s)', (_label, text) => {
    const v = moderateRecipe({ ...base, summary: text })
    expect(v.status).toBe('draft')
    expect(v.issues.some((i) => i.code === 'contacts')).toBe(true)
  })

  it('контакти шукаються і в кроках, і в порадах, і в назві', () => {
    for (const patch of [
      { steps: [...base.steps, { text: 'Деталі в інстаграмі @cook.kyiv, там же ціни.' }] },
      { tips: [{ kind: 'technique' as const, text: 'Пишіть на пошту cook@example.com' }] },
      { title: 'Сирники — замовити t.me/cakes' },
    ]) {
      expect(moderateRecipe({ ...base, ...patch }).status).toBe('draft')
    }
  })

  it('не пропускає порожні кроки: за трьома словами страву не приготувати', () => {
    const v = moderateRecipe({ ...base, steps: [{ text: 'Змішати' }, { text: 'Смажити' }] })
    expect(v.status).toBe('draft')
    expect(v.issues.some((i) => i.code === 'thin_steps')).toBe(true)
  })

  /**
   * Нерозпізнаний склад — попередження, а не блокування. Словник має
   * 77 ключів, і чесна «кіноа» не повинна ставати причиною відмови:
   * рецепт публікується, але агент не бере його в підбір, і автор про
   * це знає.
   */
  it('нерозпізнаний інгредієнт попереджає, але не блокує', () => {
    const v = moderateRecipe({ ...base, unknownIngredients: ['Кіноа'] })
    expect(v.status).toBe('published')
    const issue = v.issues.find((i) => i.code === 'unknown_ingredients')!
    expect(issue.severity).toBe('warn')
    expect(issue.message).toContain('Кіноа')
  })

  it('кілька причин повертаються разом, а не по одній', () => {
    const v = moderateRecipe({
      ...base,
      declaredAllergens: [],
      summary: 'замовлення в @shop',
      steps: [{ text: 'Змішати' }],
    })
    expect(v.status).toBe('draft')
    expect(v.issues.filter((i) => i.severity === 'block').map((i) => i.code).sort()).toEqual([
      'contacts',
      'thin_steps',
      'undeclared_allergen',
    ])
  })
})

describe('shouldHide', () => {
  it(`ховає з ${REPORTS_TO_HIDE} скарг`, () => {
    expect(shouldHide(REPORTS_TO_HIDE - 1)).toBe(false)
    expect(shouldHide(REPORTS_TO_HIDE)).toBe(true)
    expect(shouldHide(REPORTS_TO_HIDE + 5)).toBe(true)
  })
})
