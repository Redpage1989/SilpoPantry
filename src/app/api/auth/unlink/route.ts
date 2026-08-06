import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Відвʼязує акаунт «Сільпо»: видаляє збережені токени, лишаючи
 * локальні дані (комору, раціон) на місці.
 *
 * Окремо від виходу навмисно. «Вийти» — це про цей браузер; «відвʼязати» —
 * про доступ застосунку до вашого акаунта «Сільпо». Плутати їх означало б
 * лишити токен у базі після того, як людина вважає, що все відключила.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10 }, async (userId) => {
    const res = await prisma.mcpSession.deleteMany({ where: { userId } })
    await prisma.user.updateMany({ where: { id: userId }, data: { authMode: 'demo' } })
    logEvent('info', 'auth.unlinked', { removed: res.count })
    return { unlinked: res.count }
  })
}
