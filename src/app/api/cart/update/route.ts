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

    /**
     * Спершу читаємо кошик і знаходимо рядок — з двох причин.
     *
     * По-перше, companyId/branchId для запису беруться з САМОГО рядка, а не
     * з контексту доставки чи від клієнта: у мультивідправленні філія в
     * кожного рядка своя, а клієнт не має права диктувати offer.
     *
     * По-друге, якщо рядка немає — кошик уже не той, який бачить людина
     * (наприклад, сесія «Сільпо» протухла і адаптер тихо став demo).
     * Чесна відмова тут краща за мовчазний no-op у тіньовому кошику.
     */
    const current = await ctx.adapter.getCart()
    const line = current.lines.find((l) => l.productId === productId)
    if (!line) {
      throw new Error('Товару вже немає в кошику — оновіть сторінку')
    }

    const cart = await ctx.adapter.setCartQuantity(productId, quantity, {
      companyId: line.companyId,
      branchId: line.branchId,
    })
    logEvent('info', 'cart.quantity_changed', { quantity })
    return { cart, mode: ctx.adapter.mode }
  })
}
