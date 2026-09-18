import { describe, it, expect, vi } from 'vitest'
import type { McpHttpClient } from '@/lib/mcp/client'

/**
 * Контекст доставки підставний: сам bootstrap ходить у кошик і філії, і це
 * окрема історія. Тут важить лише те, що getOrders його бере й передає далі.
 */
vi.mock('@/lib/mcp/delivery-context', async (importOriginal) => ({
  // частковий мок: модуль віддає ще й isErrorPayload, без якого call() падає
  ...(await importOriginal<typeof import('@/lib/mcp/delivery-context')>()),
  bootstrapDeliveryContext: vi.fn(async () => ({
    branchId: 'branch-1',
    branchCity: 'Київ',
    deliveryType: 'DeliveryHome',
    timeslotStart: '2026-09-19T10:00:00+03:00',
    timeslotEnd: '2026-09-19T12:00:00+03:00',
    source: 'branches',
  })),
}))

import { LiveSilpoAdapter } from '@/lib/mcp/live-adapter'

/** Схема офлайн-інструмента — як на живому MCP станом на 18.09.2026. */
const OFFLINE_SCHEMA = {
  type: 'object',
  properties: {
    branchId: { type: 'string' },
    deliveryType: { type: 'string' },
    timeslotStart: { type: 'string' },
    timeslotEnd: { type: 'string' },
  },
  required: ['branchId', 'deliveryType', 'timeslotStart', 'timeslotEnd'],
}
const NO_ARGS = { type: 'object', properties: {} }

function fakeClient(tools: Record<string, object>) {
  const calls: { name: string; args: unknown }[] = []
  const client = {
    listTools: async () =>
      Object.entries(tools).map(([name, inputSchema]) => ({ name, description: '', inputSchema })),
    callTool: async (name: string, args: unknown) => {
      calls.push({ name, args })
      const id = name.includes('offline') ? 'off-1' : 'onl-1'
      return { content: [{ type: 'text', text: JSON.stringify([{ id, date: '2026-09-17T10:00:00Z', items: [] }]) }] }
    },
  } as unknown as McpHttpClient
  return { client, calls }
}

/**
 * Регресія з прода: офлайн-чеки не завантажились жодного разу. Схема
 * вимагала контексту доставки, ми слали порожні аргументи, SchemaGuard
 * відмовлявся їх відправляти, а `allSettled` ковтав відмову мовчки —
 * імпорт казав «усі покупки вже враховані».
 */
describe('LiveSilpoAdapter.getOrders', () => {
  it('офлайн-чеки отримують контекст доставки, якого вимагає схема', async () => {
    const { client, calls } = fakeClient({
      silpo_get_my_offline_orders: OFFLINE_SCHEMA,
      silpo_get_my_online_orders: NO_ARGS,
    })
    const adapter = new LiveSilpoAdapter(client)
    const orders = await adapter.getOrders()

    expect(adapter.orderSourceFailures()).toEqual([])
    expect(orders.map((o) => o.kind).sort()).toEqual(['offline_receipt', 'online_order'])
    const offline = calls.find((c) => c.name === 'silpo_get_my_offline_orders')
    expect(offline?.args).toEqual({
      branchId: 'branch-1',
      deliveryType: 'DeliveryHome',
      timeslotStart: '2026-09-19T10:00:00+03:00',
      timeslotEnd: '2026-09-19T12:00:00+03:00',
    })
  })

  it('зниклий офлайн-інструмент видно як збій джерела, онлайн при цьому вцілів', async () => {
    const { client } = fakeClient({ silpo_get_my_online_orders: NO_ARGS, silpo_get_my_receipts: NO_ARGS })
    const adapter = new LiveSilpoAdapter(client)
    const orders = await adapter.getOrders()
    expect(orders.map((o) => o.kind)).toEqual(['online_order'])
    const failures = adapter.orderSourceFailures()
    expect(failures.map((f) => f.source)).toEqual(['offline_receipt'])
    expect(failures[0].reason).toMatch(/не знайдено/)
  })

  it('збої не накопичуються між викликами', async () => {
    const { client } = fakeClient({ silpo_get_my_online_orders: NO_ARGS })
    const adapter = new LiveSilpoAdapter(client)
    await adapter.getOrders()
    await adapter.getOrders()
    expect(adapter.orderSourceFailures()).toHaveLength(1)
  })
})
