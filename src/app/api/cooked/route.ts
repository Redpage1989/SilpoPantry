import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { createToolContext, recordCookedMeal } from '@/lib/agent/tools'
import { toRecipeLike } from '@/lib/domain/user-recipes'
import { SEED_RECIPES } from '@/lib/seed/recipes'

const Input = z.object({
  slug: z.string().min(1),
  /**
   * Простір імен рецепта. Явно, а не «спершу шукаємо в книзі, потім у
   * спільноті»: slug рецепта спільноти формується з назви й цілком може
   * збігтися з книжковим («Сирники» → syrnyky), а тихо приготувати не той
   * рецепт означало б списати з комори не ті продукти.
   */
  source: z.enum(['book', 'community']).default('book'),
  servings: z.number().int().min(1).max(12),
  /** false — лише показати, що буде списано; true — застосувати */
  apply: z.boolean().default(false),
})

/** «Я це приготував» → пропозиція списати інгредієнти з комори. */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 20 }, async (userId) => {
    const input = Input.parse(await request.json())

    const recipe =
      input.source === 'book'
        ? SEED_RECIPES.find((r) => r.slug === input.slug)
        : await prisma.userRecipe
            .findFirst({ where: { slug: input.slug, status: 'published' } })
            .then((row) => (row ? toRecipeLike(row) : undefined))
    if (!recipe) throw new Error('Рецепт не знайдено')

    const ctx = await createToolContext(userId)
    const result = await recordCookedMeal(ctx, {
      recipe,
      servings: input.servings,
      apply: input.apply,
      confirmationToken: randomBytes(12).toString('base64url'),
    })
    return { ...result, trace: ctx.trace }
  })
}
