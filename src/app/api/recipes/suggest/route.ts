import { z } from 'zod'
import { handle } from '@/lib/api'
import { runRecipeSuggestions } from '@/lib/agent/orchestrator'

const Input = z.object({
  servings: z.number().int().min(1).max(12).optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'dessert', 'snack']).optional(),
  maxMinutes: z.number().int().min(5).max(240).optional(),
  maxBudget: z.number().int().min(0).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  cuisine: z.string().max(40).optional(),
  rescueMode: z.boolean().optional(),
})

/** Агентний підбір страв під наявні продукти й обмеження родини. */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 20 }, async (userId) => {
    const input = Input.parse(await request.json())
    const run = await runRecipeSuggestions(userId, input)
    return {
      mode: run.mode,
      modeReason: run.modeReason,
      plan: run.plan,
      trace: run.trace,
      durationMs: run.durationMs,
      suggestions: run.data.suggestions,
      expiring: run.data.expiring.map((e) => ({ ...e, expiryDate: e.expiryDate?.toISOString() ?? null })),
    }
  })
}
