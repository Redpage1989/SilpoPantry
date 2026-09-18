import { describe, it, expect } from 'vitest'
import { LiveSilpoAdapter } from '@/lib/mcp/live-adapter'
import type { McpHttpClient } from '@/lib/mcp/client'

/**
 * Регресія з прода: офлайн-чеки не завантажились жодного разу, а імпорт
 * казав «усі покупки вже враховані». `allSettled` ковтав збій джерела
 * мовчки. Тест стереже, що збій тепер видно — і що вцілілу половину
 * історії він не валить.
 */
function fakeClient(toolNames: string[]): McpHttpClient {
  return {
    listTools: async () =>
      toolNames.map((name) => ({ name, description: '', inputSchema: { type: 'object', properties: {} } })),
    callTool: async (name: string) => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            name === 'silpo_get_my_online_orders'
              ? [{ id: 'o-1', date: '2026-09-17T10:00:00Z', items: [] }]
              : [],
          ),
        },
      ],
    }),
  } as unknown as McpHttpClient
}

describe('LiveSilpoAdapter.getOrders', () => {
  it('зниклий офлайн-інструмент видно як збій джерела, онлайн при цьому вцілів', async () => {
    const adapter = new LiveSilpoAdapter(fakeClient(['silpo_get_my_online_orders', 'silpo_get_my_receipts']))
    const orders = await adapter.getOrders()
    expect(orders.map((o) => o.kind)).toEqual(['online_order'])
    const failures = adapter.orderSourceFailures()
    expect(failures.map((f) => f.source)).toEqual(['offline_receipt'])
    expect(failures[0].reason).toMatch(/не знайдено/)
  })

  it('коли обидва джерела відповіли, збоїв немає', async () => {
    const adapter = new LiveSilpoAdapter(
      fakeClient(['silpo_get_my_online_orders', 'silpo_get_my_offline_orders']),
    )
    await adapter.getOrders()
    expect(adapter.orderSourceFailures()).toEqual([])
  })

  it('збої не накопичуються між викликами', async () => {
    const adapter = new LiveSilpoAdapter(fakeClient(['silpo_get_my_online_orders']))
    await adapter.getOrders()
    await adapter.getOrders()
    expect(adapter.orderSourceFailures()).toHaveLength(1)
  })
})
