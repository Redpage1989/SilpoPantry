import { describe, it, expect, vi } from 'vitest'

// адаптер тягне prisma лише для кошика; пошук по каталогу до бази не ходить
vi.mock('@/lib/db', () => ({ prisma: {} }))

import { MockSilpoAdapter } from '@/lib/mcp/mock-adapter'

/**
 * Демо-каталог — це те, що бачить журі. «Плов» просив рис, а отримував
 * «Цукор білий кРИСталічний»: рису в каталозі не було, а пошук по підрядку
 * назви знаходив «рис» усередині «кристалічний».
 */
describe('демо-каталог: пошук інгредієнтів', () => {
  const adapter = new MockSilpoAdapter('test-user')

  it('на «рис» повертає рис, а не цукор', async () => {
    const [res] = await adapter.findProducts([{ ingredientKey: 'рис', query: 'Рис' }])
    expect(res.products.length).toBeGreaterThan(0)
    expect(res.products[0].name).toMatch(/^Рис/)
    expect(res.products.map((p) => p.name)).not.toContainEqual(expect.stringMatching(/Цукор/))
  })

  it('пошук по назві лишається для запитів без свого ключа', async () => {
    // «Спагеті» — не ключ інгредієнта, але є в назві товару
    const [res] = await adapter.findProducts([{ ingredientKey: 'спагеті', query: 'Спагеті' }])
    expect(res.products.map((p) => p.name)).toContainEqual(expect.stringMatching(/Спагеті/))
  })
})
