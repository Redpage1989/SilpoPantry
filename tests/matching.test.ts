import { describe, it, expect } from 'vitest'
import type { PantryEntry, RecipeLike } from '@/lib/domain/types'
import { calculateMissingIngredients } from '@/lib/domain/matching'

const localDate = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const NOW = localDate(2026, 9, 10)

function pantry(rows: Partial<PantryEntry>[]): PantryEntry[] {
  return rows.map((r, i) => ({
    id: r.id ?? `p${i}`,
    normalizedName: r.normalizedName ?? 'x',
    originalName: r.originalName ?? r.normalizedName ?? 'x',
    category: 'Інше',
    quantity: r.quantity ?? 100,
    unit: r.unit ?? 'г',
    expiryDate: r.expiryDate ?? null,
    storageLocation: 'pantry',
    source: 'manual',
    confidence: 1,
    needsConfirmation: false,
  }))
}

const RECIPE: RecipeLike = {
  id: 'r1',
  slug: 'test',
  title: 'Тестова страва',
  summary: '',
  servings: 2,
  cookingTime: 20,
  difficulty: 'easy',
  cuisine: 'Українська',
  mealType: 'dinner',
  imageEmoji: '🍲',
  tags: [],
  nutrition: { kcal: 300, protein: 10, fat: 10, carbs: 30 },
  ingredients: [
    { name: 'Макарони', normalizedName: 'макарони', quantity: 200, unit: 'г', approxPricePerUnit: 10 },
    { name: 'Вершки', normalizedName: 'вершки', quantity: 100, unit: 'мл', substitutes: ['сметана'], approxPricePerUnit: 12 },
    { name: 'Базилік', normalizedName: 'базилік', quantity: 5, unit: 'г', optional: true, approxPricePerUnit: 100 },
  ],
  steps: [],
}

describe('calculateMissingIngredients', () => {
  it('усе є вдома — покриття 100%, докупівля нульова', () => {
    const res = calculateMissingIngredients(
      RECIPE,
      pantry([
        { normalizedName: 'макарони', quantity: 400, unit: 'г' },
        { normalizedName: 'вершки', quantity: 200, unit: 'мл' },
      ]),
      { now: NOW },
    )
    expect(res.coverage).toBe(1)
    // необовʼязковий базилік лишається у списку, але не рахується у вартість
    expect(res.missing.filter((m) => !m.optional)).toHaveLength(0)
    expect(res.approxMissingCost).toBe(0)
  })

  it('розрізняє повну відсутність і часткову нестачу', () => {
    const res = calculateMissingIngredients(
      RECIPE,
      pantry([{ normalizedName: 'макарони', quantity: 120, unit: 'г' }]),
      { now: NOW },
    )
    const pasta = res.missing.find((m) => m.normalizedName === 'макарони')!
    const cream = res.missing.find((m) => m.normalizedName === 'вершки')!
    expect(pasta.kind).toBe('insufficient')
    expect(pasta.missing).toBe(80)
    expect(cream.kind).toBe('absent')
    expect(cream.missing).toBe(100)
  })

  it('закриває інгредієнт дозволеною заміною і повідомляє про це', () => {
    const res = calculateMissingIngredients(
      RECIPE,
      pantry([
        { normalizedName: 'макарони', quantity: 400, unit: 'г' },
        { normalizedName: 'сметана', originalName: 'Сметана 20%', quantity: 200, unit: 'мл' },
      ]),
      { now: NOW },
    )
    expect(res.missing.filter((m) => !m.optional)).toHaveLength(0)
    expect(res.coverage).toBe(1)
  })

  it('необовʼязковий інгредієнт не впливає на покриття', () => {
    const res = calculateMissingIngredients(
      RECIPE,
      pantry([
        { normalizedName: 'макарони', quantity: 400, unit: 'г' },
        { normalizedName: 'вершки', quantity: 200, unit: 'мл' },
      ]),
      { now: NOW },
    )
    const basil = res.missing.find((m) => m.normalizedName === 'базилік')
    expect(basil?.optional).toBe(true)
    expect(res.coverage).toBe(1)
  })

  it('масштабує потребу під кількість порцій', () => {
    const res = calculateMissingIngredients(RECIPE, pantry([]), { servings: 4, now: NOW })
    const pasta = res.missing.find((m) => m.normalizedName === 'макарони')!
    expect(pasta.missing).toBe(400)
  })

  it('позначає порятунок продукту з близьким терміном придатності', () => {
    const res = calculateMissingIngredients(
      RECIPE,
      pantry([
        { normalizedName: 'макарони', quantity: 400, unit: 'г' },
        { normalizedName: 'вершки', quantity: 200, unit: 'мл', expiryDate: localDate(2026, 9, 11) },
      ]),
      { now: NOW },
    )
    expect(res.rescues).toContain('вершки')
  })

  it('не зараховує один продукт двічі різним інгредієнтам', () => {
    const recipe: RecipeLike = {
      ...RECIPE,
      ingredients: [
        { name: 'Молоко A', normalizedName: 'молоко', quantity: 200, unit: 'мл' },
        { name: 'Молоко B', normalizedName: 'молоко', quantity: 200, unit: 'мл' },
      ],
    }
    const res = calculateMissingIngredients(recipe, pantry([{ normalizedName: 'молоко', quantity: 300, unit: 'мл' }]), {
      now: NOW,
    })
    const totalMissing = res.missing.reduce((s, m) => s + m.missing, 0)
    expect(totalMissing).toBe(100)
  })

  it('не змішує масу з обʼємом при матчингу', () => {
    // 200 г сиру не можуть закрити 100 мл вершків
    const res = calculateMissingIngredients(
      RECIPE,
      pantry([
        { normalizedName: 'макарони', quantity: 400, unit: 'г' },
        { normalizedName: 'вершки', quantity: 200, unit: 'г' },
      ]),
      { now: NOW },
    )
    expect(res.missing.find((m) => m.normalizedName === 'вершки')?.kind).toBe('absent')
  })

  it('оцінює вартість докупівлі за ціною інгредієнта', () => {
    const res = calculateMissingIngredients(RECIPE, pantry([]), { now: NOW })
    // 200 г × 10 коп + 100 мл × 12 коп = 2000 + 1200
    expect(res.approxMissingCost).toBe(3200)
  })
})
