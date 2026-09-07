import { describe, it, expect, vi } from 'vitest'

// адаптер тягне prisma лише для кошика; пошук по каталогу до бази не ходить
vi.mock('@/lib/db', () => ({ prisma: {} }))

import { MockSilpoAdapter } from '@/lib/mcp/mock-adapter'
import { MOCK_CATALOG } from '@/lib/seed/silpo-mock'
import { SEED_RECIPES } from '@/lib/seed/recipes'

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

/**
 * Кожен інгредієнт книги рецептів має товар у демо-каталозі. Інакше журі
 * бачить «Товарів не знайдено в каталозі» на екрані страви — так було з
 * морквою в «Плові» й із картоплею в шести рецептах.
 */
describe('демо-каталог покриває книгу рецептів', () => {
  it('для кожного ключа інгредієнта є хоча б один товар (не готова страва)', () => {
    const covered = new Set(MOCK_CATALOG.filter((p) => !p.readyMeal).map((p) => p.ingredientKey))
    const missing = new Set<string>()
    for (const r of SEED_RECIPES) {
      const ings = typeof r.ingredients === 'string' ? JSON.parse(r.ingredients) : r.ingredients
      for (const i of ings as { normalizedName: string }[]) if (!covered.has(i.normalizedName)) missing.add(i.normalizedName)
    }
    expect([...missing].sort()).toEqual([])
  })
})
