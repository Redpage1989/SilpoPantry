import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { handle } from '@/lib/api'
import { createToolContext, recordCookedMeal } from '@/lib/agent/tools'
import { SEED_RECIPES } from '@/lib/seed/recipes'

const Input = z.object({
  slug: z.string().min(1),
  servings: z.number().int().min(1).max(12),
  /** false — лише показати, що буде списано; true — застосувати */
  apply: z.boolean().default(false),
})

/** «Я це приготував» → пропозиція списати інгредієнти з комори. */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 20 }, async (userId) => {
    const input = Input.parse(await request.json())
    const recipe = SEED_RECIPES.find((r) => r.slug === input.slug)
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
