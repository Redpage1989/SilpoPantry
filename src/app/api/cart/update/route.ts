import { z } from 'zod'
import { handle } from '@/lib/api'
import { createToolContext } from '@/lib/agent/tools'
import { logEvent } from '@/lib/mcp/pii'

const Input = z.object({
  productId: z.string().min(1),
  /** 0 означає «видалити позицію» */
  quantity: z.number().min(0).max(99),
})

/**
 * Зміна кількості товару в кошику вручну.
 *
 * Це НЕ дія агента, а пряме керування власним кошиком: людина натискає
 * «−» або «+» на конкретному рядку. Тому тут немає токена підтвердження —
 * саме натискання і є підтвердженням. Правило «агент не змінює кошик
 * самостійно» лишається чинним: агент ходить лише через /api/cart/confirm
 * з одноразовим токеном пропозиції.
 *
 * CSRF і ліміт частоти обовʼязкові: маршрут пише в реальний кошик «Сільпо».
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 40 }, async (userId) => {
    const { productId, quantity } = Input.parse(await request.json())
    const ctx = await createToolContext(userId)
    const cart = await ctx.adapter.setCartQuantity(productId, quantity)
    logEvent('info', 'cart.quantity_changed', { quantity })
    return { cart, mode: ctx.adapter.mode }
  })
}
