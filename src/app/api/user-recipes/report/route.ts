import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { shouldHide, REPORTS_TO_HIDE } from '@/lib/domain/moderation'
import { logEvent } from '@/lib/mcp/pii'

const Input = z.object({
  recipeId: z.string().min(1),
  reason: z.enum(['unsafe', 'spam', 'not_a_recipe', 'other']),
})

/**
 * Скарга на опублікований рецепт.
 *
 * Друга половина модерації. Автоперевірка ловить те, що доводиться кодом:
 * незаявлений алерген, контакти, порожні кроки. Усе інше — небезпечну
 * пораду, лайку, чужий текст — бачить лише людина, і єдиний спосіб про це
 * дізнатись у прототипі без штату модераторів — дати читачам кнопку.
 *
 * Ховає рецепт не перша скарга, а третя, і рахуються скарги РІЗНИХ людей
 * (унікальність гарантує база). Інакше один незадоволений прибрав би
 * будь-що з кількох вкладок.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10 }, async (userId) => {
    const { recipeId, reason } = Input.parse(await request.json())

    const recipe = await prisma.userRecipe.findUnique({ where: { id: recipeId } })
    if (!recipe || recipe.status === 'draft') throw new Error('Рецепт не знайдено')
    if (recipe.authorId === userId) throw new Error('На власний рецепт скаржитись не можна')

    await prisma.recipeReport
      .create({ data: { userRecipeId: recipeId, reporterId: userId, reason } })
      .catch(() => undefined) // унікальний (рецепт, скаржник): повторна скарга нічого не додає

    const reports = await prisma.recipeReport.count({ where: { userRecipeId: recipeId } })
    const hide = shouldHide(reports)
    if (hide && recipe.status !== 'hidden') {
      await prisma.userRecipe.update({ where: { id: recipeId }, data: { status: 'hidden' } })
      logEvent('warn', 'user_recipe.hidden', { reports })
    }

    return {
      reports,
      hidden: hide,
      /**
       * Скільки ще скарг до приховування — не таємниця: людина має розуміти,
       * що її натискання не зникло в порожнечі, навіть якщо рецепт лишився.
       */
      note: hide
        ? 'Рецепт прибрано зі стрічки. Автор бачить це у своєму списку.'
        : `Скаргу враховано. Рецепт ховається після ${REPORTS_TO_HIDE} скарг від різних людей.`,
    }
  })
}
