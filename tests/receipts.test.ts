import { describe, it, expect } from 'vitest'
import {
  inferPantryFromReceipts,
  remainingFraction,
  inferenceConfidence,
  parsePackFromName,
  type ReceiptForImport,
} from '@/lib/domain/receipts'

const NOW = new Date(2026, 8, 10, 12) // 10 вересня 2026

function isoDaysAgo(days: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

function receipt(items: { name: string; quantity?: number }[], daysAgo: number, id = 'r1'): ReceiptForImport {
  return {
    orderId: id,
    date: isoDaysAgo(daysAgo),
    kind: 'offline_receipt',
    items: items.map((i, idx) => ({
      productId: `p${idx}`,
      name: i.name,
      quantity: i.quantity ?? 1,
      price: 1000,
    })),
  }
}

describe('розбір розміру упаковки з назви', () => {
  it('витягує вагу й обʼєм із типових назв «Сільпо»', () => {
    expect(parsePackFromName('Молоко 2,5%, 900 мл')).toEqual({ size: 900, unit: 'мл' })
    expect(parsePackFromName('Яйця курячі С1, 10 шт')).toEqual({ size: 10, unit: 'шт' })
    expect(parsePackFromName('Цукор білий, 1 кг')).toEqual({ size: 1, unit: 'кг' })
  })

  it('повертає null, коли розміру немає', () => {
    expect(parsePackFromName('Хліб житній')).toBeNull()
  })
})

describe('крива споживання', () => {
  it('у день покупки лишається все', () => {
    expect(remainingFraction(0, 7)).toBe(1)
  })

  it('швидкопсувне «зʼїдається» швидше за бакалію', () => {
    expect(remainingFraction(3, 5)).toBeLessThan(remainingFraction(3, 180))
  })

  it('ніколи не йде в мінус', () => {
    expect(remainingFraction(100, 5)).toBe(0)
  })

  it('впевненість падає з часом і не перевищує 0,75', () => {
    expect(inferenceConfidence(0, 7)).toBeLessThanOrEqual(0.75)
    expect(inferenceConfidence(10, 7)).toBeLessThan(inferenceConfidence(1, 7))
    expect(inferenceConfidence(100, 7)).toBeGreaterThanOrEqual(0.2)
  })
})

describe('інференс комори з чеків', () => {
  it('створює позиції з нормалізованою назвою, категорією і терміном', () => {
    const { items } = inferPantryFromReceipts([receipt([{ name: 'Молоко 2,5%, 900 мл' }], 1)], NOW)
    expect(items).toHaveLength(1)
    expect(items[0].normalizedName).toBe('молоко')
    expect(items[0].category).toBe('Молочні продукти')
    expect(items[0].storageLocation).toBe('fridge')
    expect(items[0].unit).toBe('мл')
    expect(items[0].expiryDate).toBeInstanceOf(Date)
  })

  it('усі позиції з чека потребують підтвердження і мають знижену впевненість', () => {
    const { items } = inferPantryFromReceipts([receipt([{ name: 'Макарони Спагеті, 400 г' }], 2)], NOW)
    expect(items[0].needsConfirmation).toBe(true)
    expect(items[0].confidence).toBeLessThan(0.8)
  })

  it('не імпортує те, що за типовим терміном уже зіпсувалось', () => {
    const { items, decisions } = inferPantryFromReceipts([receipt([{ name: 'Шпинат свіжий, 100 г' }], 30)], NOW)
    expect(items).toHaveLength(0)
    expect(decisions[0].decision).toBe('skipped_expired')
  })

  it('відкидає непродовольчі позиції', () => {
    const { items, decisions } = inferPantryFromReceipts(
      [receipt([{ name: 'Пакет-майка' }, { name: 'Мило рідке' }], 1)],
      NOW,
    )
    expect(items).toHaveLength(0)
    expect(decisions.every((d) => d.decision === 'skipped_non_food')).toBe(true)
  })

  it('обʼєднує один продукт із різних чеків в одну позицію', () => {
    const { items } = inferPantryFromReceipts(
      [
        receipt([{ name: 'Молоко 2,5%, 900 мл' }], 1, 'r1'),
        receipt([{ name: 'Молоко 2,5%, 900 мл' }], 0, 'r2'),
      ],
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(items[0].quantity).toBeGreaterThan(900)
  })

  it('множить кількість на число упаковок у чеку', () => {
    const { items } = inferPantryFromReceipts([receipt([{ name: 'Молоко 2,5%, 900 мл', quantity: 2 }], 0)], NOW)
    expect(items[0].quantity).toBe(1800)
  })

  it('позначає джерело і дає людяне пояснення походження', () => {
    const { items } = inferPantryFromReceipts([receipt([{ name: 'Кава мелена, 250 г' }], 1)], NOW)
    expect(items[0].source).toBe('offline_receipt')
    expect(items[0].provenance).toContain('Чек «Сільпо»')
  })

  it('онлайн-замовлення позначається окремим джерелом', () => {
    const online: ReceiptForImport = { ...receipt([{ name: 'Борошно, 1 кг' }], 1), kind: 'online_order' }
    const { items } = inferPantryFromReceipts([online], NOW)
    expect(items[0].source).toBe('online_order')
    expect(items[0].provenance).toContain('Онлайн-замовлення')
  })

  it('порожній список чеків не ламає імпорт', () => {
    expect(inferPantryFromReceipts([], NOW)).toEqual({ items: [], decisions: [] })
  })
})
