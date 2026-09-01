import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { FULFILLMENTS } from '@/lib/domain/fulfillment'

const Input = z.object({ method: z.enum(FULFILLMENTS) })

/**
 * Спосіб отримання замовлення — налаштування користувача, не запис у «Сільпо»:
 * у пропонованому MCP-контракті такого інструмента немає (PLAN.md).
 * Суми перераховує runCartOverview при наступному читанні кошика.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 30 }, async (userId) => {
    const input = Input.parse(await request.json())
    await prisma.user.update({ where: { id: userId }, data: { fulfillment: input.method } })
    return { ok: true, fulfillment: input.method }
  })
}
