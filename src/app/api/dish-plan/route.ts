import { z } from 'zod'
import { handle } from '@/lib/api'
import { runDishPlan } from '@/lib/agent/orchestrator'

const Input = z.object({
  query: z.string().min(2).max(120),
  servings: z.number().int().min(1).max(12).optional(),
})

/**
 * Сценарій «Хочу приготувати X».
 * Повертає план, три цінові варіанти, порівняння «готувати vs купити»
 * і ЧЕРНЕТКУ пропозиції. Кошик на цьому кроці не змінюється.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 15 }, async (userId) => {
    const input = Input.parse(await request.json())
    const run = await runDishPlan(userId, input)
    return {
      mode: run.mode,
      modeReason: run.modeReason,
      plan: run.plan,
      trace: run.trace,
      durationMs: run.durationMs,
      liveMcpCalls: run.liveMcpCalls,
      ...run.data,
    }
  })
}
