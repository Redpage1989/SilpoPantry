import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { createToolContext, addConfirmedItemsToCart, getCartSummary } from '@/lib/agent/tools'

const Input = z.object({ proposalId: z.string().min(1) })

/**
 * Підтвердження раніше створеної чернетки з екрана кошика.
 *
 * Токен пропозиції клієнту не видається взагалі — сервер читає його з БД
 * і сам передає у write-tool. Клієнт лише каже «так» (плюс CSRF-заголовок).
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10 }, async (userId) => {
    const { proposalId } = Input.parse(await request.json())
    const proposal = await prisma.shoppingProposal.findFirst({
      where: { id: proposalId, userId, status: 'draft' },
    })
    if (!proposal) throw new Error('Чернетку не знайдено або вже підтверджено')

    const ctx = await createToolContext(userId)
    const cart = await addConfirmedItemsToCart(ctx, {
      proposalId: proposal.id,
      confirmationToken: proposal.confirmationToken,
    })
    const summary = await getCartSummary(ctx)
    return { cart, summary, mode: ctx.adapter.mode, trace: ctx.trace }
  })
}
