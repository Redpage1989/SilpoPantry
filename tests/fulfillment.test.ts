import { describe, it, expect } from 'vitest'
import type { SilpoCart } from '@/lib/mcp/types'
import { applyFulfillment, normalizeFulfillment } from '@/lib/domain/fulfillment'

const line = { productId: 'p1', name: 'Сир Маскарпоне', price: 10000, quantity: 2 } as SilpoCart['lines'][number]

const cart = (over: Partial<SilpoCart> = {}): SilpoCart => ({
  cartId: 'demo-cart-1',
  lines: [line],
  subtotal: 20000,
  discount: 1000,
  total: 20000 - 1000 + 3900,
  deliveryPrice: 3900,
  balabonusesAvailable: 120,
  validations: [],
  checkoutUrl: 'https://silpo.ua/cart?demo=1',
  ...over,
})

/**
 * Спосіб отримання — надбудова застосунку поверх кошика від адаптера.
 * Самовивіз і «у магазині» прибирають вартість доставки та попередження
 * про неї; «у магазині» ще й ховає зовнішнє оформлення — кошик стає
 * списком покупок.
 */
describe('applyFulfillment: спосіб отримання перераховує кошик', () => {
  it('доставка: кошик не змінюється взагалі', () => {
    const c = cart({ validations: ['Мінімальна сума замовлення з доставкою — 300,00 грн'] })
    expect(applyFulfillment(c, 'delivery')).toEqual(c)
  })

  it('самовивіз: доставка 0, «разом» без доставки, мінімалка доставки знімається', () => {
    const c = cart({ validations: ['Мінімальна сума замовлення з доставкою — 300,00 грн'] })
    const r = applyFulfillment(c, 'pickup')
    expect(r.deliveryPrice).toBe(0)
    expect(r.total).toBe(19000) // 200,00 − 10,00, без 39 грн доставки
    expect(r.validations).toEqual([])
    // зібране замовлення все ще оформлюється назовні
    expect(r.checkoutUrl).toBe(c.checkoutUrl)
  })

  it('самовивіз не ховає попереджень, які не про доставку', () => {
    const r = applyFulfillment(cart({ validations: ['Товару «Савоярді» лишилось 2 шт'] }), 'pickup')
    expect(r.validations).toEqual(['Товару «Савоярді» лишилось 2 шт'])
  })

  it('у магазині: як самовивіз, але без зовнішнього оформлення', () => {
    const r = applyFulfillment(cart(), 'instore')
    expect(r.deliveryPrice).toBe(0)
    expect(r.total).toBe(19000)
    expect(r.checkoutUrl).toBeNull()
  })

  it('поля «Сільпо» поза доставкою не втрачаються', () => {
    // балабонуси нараховує ритейлер — спосіб отримання їх не стосується
    expect(applyFulfillment(cart(), 'instore').balabonusesAvailable).toBe(120)
  })

  it('порожній кошик лишається чесним для будь-якого способу', () => {
    const empty = cart({ lines: [], subtotal: 0, discount: 0, total: 0, deliveryPrice: 0, validations: ['Кошик порожній'], checkoutUrl: null })
    for (const method of ['delivery', 'pickup', 'instore'] as const) {
      const r = applyFulfillment(empty, method)
      expect(r.total).toBe(0)
      expect(r.validations).toEqual(['Кошик порожній'])
    }
  })

  it('вхідний кошик не мутується', () => {
    const c = cart()
    const before = structuredClone(c)
    applyFulfillment(c, 'instore')
    expect(c).toEqual(before)
  })
})

describe('normalizeFulfillment: значення з БД чи ззовні', () => {
  it('відомі способи проходять як є', () => {
    expect(normalizeFulfillment('delivery')).toBe('delivery')
    expect(normalizeFulfillment('pickup')).toBe('pickup')
    expect(normalizeFulfillment('instore')).toBe('instore')
  })

  it('невідоме, порожнє чи відсутнє → доставка (безпечний дефолт)', () => {
    expect(normalizeFulfillment('teleport')).toBe('delivery')
    expect(normalizeFulfillment('')).toBe('delivery')
    expect(normalizeFulfillment(null)).toBe('delivery')
    expect(normalizeFulfillment(undefined)).toBe('delivery')
  })
})
