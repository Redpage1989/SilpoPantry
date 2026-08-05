import { handle } from '@/lib/api'
import { resolveAdapterSafe } from '@/lib/mcp'

/**
 * Живий доказ інтеграції: викликає tools/list на MCP «Сільпо»
 * і повертає перелік доступних інструментів разом із режимом.
 * Використовується екраном /trace для демонстрації журі.
 */
export async function GET(request: Request) {
  return handle(request, { rateLimitPerMinute: 10 }, async (userId) => {
    const { adapter, reason, canGoLive } = await resolveAdapterSafe(userId)
    const started = Date.now()
    const tools = await adapter.listTools()
    return {
      mode: adapter.mode,
      reason,
      canGoLive,
      durationMs: Date.now() - started,
      count: tools.length,
      tools,
      trace: adapter.drainTrace(),
    }
  })
}
