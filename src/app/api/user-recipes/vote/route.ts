import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { isoWeek } from '@/lib/domain/user-recipes'

const Input = z.object({ recipeId: z.string().min(1) })

/**
 * Голос за рецепт тижня. Повторний виклик знімає голос.
 *
 * Унікальність (recipe, voter, week) гарантує база, а не код: без цього
 * достатньо двох паралельних натискань, щоб отримати два голоси від
 * однієї людини.
 *
 * Голос ЗАРОБЛЯЄТЬСЯ приготуванням. Доти достатньо було проґортати стрічку
 * й натиснути зірочку — тобто голосували за назву й емодзі, а не за страву.
 * Накрутити тепер не можна не через перевірку особи, а через продукти:
 * «Я це приготував» списує інгредієнти з комори, і порожня комора не дає
 * приготувати нічого. Три голоси означають три родини, які це справді
 * зварили.
 *
 * Знімати свій голос можна завжди: інакше людина, яка передумала, лишалася б
 * заручником власного натискання.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 30 }, async (userId) => {
    const { recipeId } = Input.parse(await request.json())
    const week = isoWeek(new Date())

    const recipe = await prisma.userRecipe.findFirst({
      where: { id: recipeId, status: 'published' },
    })
    if (!recipe) throw new Error('Рецепт не знайдено')
    if (recipe.authorId === userId) {
      throw new Error('За власний рецепт голосувати не можна')
    }

    const cooked = await prisma.cookedMeal.findFirst({
      where: { userId, recipeSlug: recipe.slug },
      select: { id: true },
    })

    const existing = await prisma.recipeVote.findUnique({
      where: { userRecipeId_voterId_isoWeek: { userRecipeId: recipeId, voterId: userId, isoWeek: week } },
    })

    if (existing) {
      await prisma.recipeVote.delete({ where: { id: existing.id } })
    } else {
      if (!cooked) {
        throw new Error('Спершу приготуйте цей рецепт — голос дає лише власний досвід')
      }
      await prisma.recipeVote.create({
        data: { userRecipeId: recipeId, voterId: userId, isoWeek: week },
      })
    }

    const votesThisWeek = await prisma.recipeVote.count({
      where: { userRecipeId: recipeId, isoWeek: week },
    })
    return { voted: !existing, votesThisWeek, isoWeek: week }
  })
}
