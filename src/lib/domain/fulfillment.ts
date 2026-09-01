import type { SilpoCart } from '../mcp/types'

/**
 * Спосіб отримання замовлення.
 *
 * Це надбудова ЗАСТОСУНКУ поверх кошика від адаптера, а не частина
 * MCP-контракту: у пропонованому контракті «Сільпо» немає write-інструмента
 * для способу отримання, і вигадувати його не можна (див. PLAN.md — там
 * поле запропоноване на майбутнє). Тому вибір зберігається на користувачі,
 * а суми перераховує чиста функція нижче.
 *
 *   delivery — курʼєрська доставка, як було завжди;
 *   pickup   — самовивіз: замовлення збирають, доставка 0 грн;
 *   instore  — «у магазині»: кошик стає списком покупок — без збирання
 *              і зовнішнього оформлення, оплата на касі.
 */
export const FULFILLMENTS = ['delivery', 'pickup', 'instore'] as const
export type Fulfillment = (typeof FULFILLMENTS)[number]

/** Значення з БД чи ззовні: невідоме → доставка, бо так було до появи вибору. */
export function normalizeFulfillment(raw: string | null | undefined): Fulfillment {
  return (FULFILLMENTS as readonly string[]).includes(raw ?? '') ? (raw as Fulfillment) : 'delivery'
}

/**
 * Перерахунок кошика під обраний спосіб отримання. Без мутацій входу.
 *
 * Попередження фільтруються за словом «доставк»: мінімалка «з доставкою»
 * не стосується самовивозу. Це чесна межа прототипу — у live реальний API
 * сам скаже, які validation-и належать способу отримання.
 */
export function applyFulfillment(cart: SilpoCart, method: Fulfillment): SilpoCart {
  if (method === 'delivery') return cart
  return {
    ...cart,
    deliveryPrice: 0,
    total: cart.subtotal - cart.discount,
    validations: cart.validations.filter((v) => !v.toLowerCase().includes('доставк')),
    // список покупок для магазину не оформлюється назовні — прибираємо посилання
    checkoutUrl: method === 'instore' ? null : cart.checkoutUrl,
  }
}

/** Підписи для UI — єдине джерело, щоб чипи й рядок підсумку не розходились. */
export const FULFILLMENT_LABELS: Record<Fulfillment, { title: string; hint: string }> = {
  delivery: { title: 'Доставка', hint: 'курʼєром на адресу' },
  pickup: { title: 'Самовивіз', hint: 'зберемо, заберете в магазині' },
  instore: { title: 'У магазині', hint: 'кошик стане списком покупок' },
}
