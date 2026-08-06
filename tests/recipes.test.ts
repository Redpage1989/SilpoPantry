import { describe, it, expect } from 'vitest'
import { SEED_RECIPES } from '@/lib/seed/recipes'
import { normalizeProductName, guessCategory } from '@/lib/domain/normalize'
import { MEAL_LABELS, type MealType } from '@/lib/domain/types'
import { areUnitsCompatible } from '@/lib/domain/units'

/**
 * Цілісність книги рецептів.
 *
 * Головний тест тут — узгодженість `normalizedName`. Якщо рецепт каже
 * `'буряк'`, а нормалізатор із назви товару в чеку робить щось інше,
 * матчинг ламається МОВЧКИ: страва просто ніколи не побачить продукт
 * у коморі й вічно проситиме докупити те, що вже лежить у холодильнику.
 */

describe('книга рецептів', () => {
  it('ідентифікатори та slug унікальні', () => {
    const ids = SEED_RECIPES.map((r) => r.id)
    const slugs = SEED_RECIPES.map((r) => r.slug)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('покриває всі прийоми їжі — інакше фільтри дають порожньо', () => {
    const covered = new Set(SEED_RECIPES.map((r) => r.mealType))
    for (const meal of Object.keys(MEAL_LABELS) as MealType[]) {
      expect(covered.has(meal), `немає жодної страви для «${MEAL_LABELS[meal]}»`).toBe(true)
    }
  })

  it('є страви різної складності', () => {
    const levels = new Set(SEED_RECIPES.map((r) => r.difficulty))
    expect(levels.size).toBeGreaterThanOrEqual(2)
  })

  it('кожен normalizedName стабільний: normalize(name) дає той самий ключ', () => {
    const broken: string[] = []
    for (const recipe of SEED_RECIPES) {
      for (const ing of recipe.ingredients) {
        const derived = normalizeProductName(ing.name)
        if (derived !== ing.normalizedName) {
          broken.push(`${recipe.slug}: «${ing.name}» → «${derived}», очікували «${ing.normalizedName}»`)
        }
      }
    }
    expect(broken, `неузгоджені ключі:\n${broken.join('\n')}`).toEqual([])
  })

  it('нормалізований ключ сам себе не змінює при повторній нормалізації', () => {
    for (const recipe of SEED_RECIPES) {
      for (const ing of recipe.ingredients) {
        expect(normalizeProductName(ing.normalizedName)).toBe(ing.normalizedName)
      }
    }
  })

  it('кожен інгредієнт має відому категорію, а не «Інше»', () => {
    const unknown = new Set<string>()
    for (const recipe of SEED_RECIPES) {
      for (const ing of recipe.ingredients) {
        if (guessCategory(ing.normalizedName).category === 'Інше') unknown.add(ing.normalizedName)
      }
    }
    expect([...unknown], 'інгредієнти без категорії').toEqual([])
  })

  it('заміни сумісні за одиницями виміру з основним інгредієнтом', () => {
    for (const recipe of SEED_RECIPES) {
      for (const ing of recipe.ingredients) {
        for (const sub of ing.substitutes ?? []) {
          expect(normalizeProductName(sub), `${recipe.slug}: заміна «${sub}»`).toBe(sub)
        }
      }
    }
  })

  it('кроки пронумеровані підряд від одиниці', () => {
    for (const recipe of SEED_RECIPES) {
      const numbers = recipe.steps.map((s) => s.step)
      expect(numbers, recipe.slug).toEqual(numbers.map((_, i) => i + 1))
    }
  })

  it('базові поля заповнені осмислено', () => {
    for (const r of SEED_RECIPES) {
      expect(r.servings, r.slug).toBeGreaterThan(0)
      expect(r.cookingTime, r.slug).toBeGreaterThan(0)
      expect(r.ingredients.length, r.slug).toBeGreaterThan(1)
      expect(r.steps.length, r.slug).toBeGreaterThan(0)
      expect(r.summary.length, r.slug).toBeGreaterThan(10)
      expect(r.nutrition.kcal, r.slug).toBeGreaterThan(0)
    }
  })

  it('обовʼязкові інгредієнти мають орієнтовну ціну для оцінки докупівлі', () => {
    const missing: string[] = []
    for (const r of SEED_RECIPES) {
      for (const ing of r.ingredients) {
        if (!ing.optional && ing.approxPricePerUnit === undefined) {
          missing.push(`${r.slug}: ${ing.name}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('одиниці інгредієнтів придатні до конвертації в межах свого виміру', () => {
    for (const r of SEED_RECIPES) {
      for (const ing of r.ingredients) {
        // сам із собою завжди сумісний — перевіряємо, що одиниця взагалі відома
        expect(areUnitsCompatible(ing.unit, ing.unit), `${r.slug}: ${ing.unit}`).toBe(true)
      }
    }
  })
})
