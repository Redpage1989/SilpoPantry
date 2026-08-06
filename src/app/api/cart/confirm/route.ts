import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { createToolContext, addConfirmedItemsToCart, getCartSummary, type ProposalLine } from '@/lib/agent/tools'

const Input = z.object({
  proposalId: z.string().min(1),
  confirmationToken: z.string().min(8),
  /** користувач міг перемкнути ціновий рівень перед підтвердженням */
  tier: z.enum(['budget', 'optimal', 'premium']).optional(),
  /** заново передані рядки — якщо користувач змінив вибір товарів */
  lines: z
    .array(
      z.object({
        ingredientName: z.string(),
        normalizedName: z.string(),
        productId: z.string(),
        companyId: z.string().optional(),
        branchId: z.string().optional(),
        productName: z.string(),
        tier: z.string(),
        quantity: z.number().int().min(1).max(20),
        price: z.number().int().min(0),
        promoPrice: z.number().int().min(0).optional(),
        lineTotal: z.number().int().min(0),
        promoSaving: z.number().int().min(0),
        warnings: z.array(z.string()).default([]),
      }),
    )
    .optional(),
})

/**
 * ЄДИНА точка, яка змінює кошик «Сільпо».
 *
 * Три бар'єри перед write-викликом MCP:
 *   1. CSRF-токен (double submit),
 *   2. одноразовий confirmationToken пропозиції,
 *   3. звірка, що пропозиція належить саме цьому користувачу і ще не додана.
 *
 * Агент не має жодного шляху додати товари в обхід цього маршруту.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10 }, async (userId) => {
    const input = Input.parse(await request.json())

    // Якщо користувач змінив вибір — перезаписуємо рядки пропозиції перед додаванням
    if (input.lines && input.lines.length > 0) {
      /**
       * Статус тут навмисно НЕ перевіряємо.
       *
       * Нова пропозиція скасовує попередні з тією ж метою (щоб екран кошика
       * не заростав дублями). Але користувач може дивитись на екран, який
       * побудували раніше, — і його підтвердження має спрацювати. Гарантією
       * є одноразовий confirmationToken, а не статус рядка; повторне
       * додавання все одно відсікається перевіркою `added_to_cart`.
       */
      const proposal = await prisma.shoppingProposal.findFirst({
        where: { id: input.proposalId, userId },
      })
      if (!proposal) throw new Error('Пропозицію не знайдено')
      const total = input.lines.reduce((s, l) => s + l.lineTotal, 0)
      await prisma.shoppingProposal.update({
        where: { id: proposal.id },
        data: { selectedProducts: JSON.stringify(input.lines as ProposalLine[]), totalPrice: total },
      })
    }

    const ctx = await createToolContext(userId)
    const cart = await addConfirmedItemsToCart(ctx, {
      proposalId: input.proposalId,
      confirmationToken: input.confirmationToken,
    })
    const summary = await getCartSummary(ctx)

    return {
      mode: ctx.adapter.mode,
      modeReason: ctx.adapterReason,
      cart,
      summary,
      trace: ctx.trace,
    }
  })
}
