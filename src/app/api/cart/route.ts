import { handle } from '@/lib/api'
import { runCartOverview } from '@/lib/agent/orchestrator'

/** Кошик, купони, балабонуси, слоти доставки та чернетки пропозицій. */
export async function GET(request: Request) {
  return handle(request, { rateLimitPerMinute: 30 }, async (userId) => {
    const run = await runCartOverview(userId)
    return {
      mode: run.mode,
      modeReason: run.modeReason,
      trace: run.trace,
      ...run.data,
    }
  })
}
