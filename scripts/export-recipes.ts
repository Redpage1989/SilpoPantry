/**
 * Вивантажує книгу рецептів у JSON на етапі збірки.
 *
 * Навіщо: у контейнері рантайму немає TypeScript, а таблиця Recipe мусить
 * бути наповнена — MealPlan має на неї зовнішній ключ, і збереження раціону
 * без рецептів впаде. Тягнути tsx у продакшн-образ заради одного файлу
 * недоречно, тож JSON генерується один раз під час збірки.
 */
import { writeFileSync } from 'node:fs'
import { SEED_RECIPES } from '../src/lib/seed/recipes'

const rows = SEED_RECIPES.map((r) => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  summary: r.summary,
  servings: r.servings,
  cookingTime: r.cookingTime,
  difficulty: r.difficulty,
  cuisine: r.cuisine,
  mealType: r.mealType,
  ingredients: JSON.stringify(r.ingredients),
  steps: JSON.stringify(r.steps),
  nutrition: JSON.stringify(r.nutrition),
  tags: JSON.stringify(r.tags),
  imageEmoji: r.imageEmoji,
  source: 'seed',
}))

writeFileSync('prisma/recipes.json', JSON.stringify(rows, null, 1))
console.log(`prisma/recipes.json — ${rows.length} рецептів`)
