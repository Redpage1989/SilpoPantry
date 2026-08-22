import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resetDemoCart } from '@/lib/mcp/mock-adapter'
import { seedDemoUser, seedRecipes } from '@/lib/seed/demo'
import { errorResponse } from '@/lib/api'
import { getUserId } from '@/lib/session'

/**
 * Скидання demo-стану до seed-значень.
 *
 * Потрібне для ізоляції E2E: тести ділять одного демо-користувача, і без
 * скидання один тест «зʼїдає» шпинат, від якого залежить інший.
 *
 * У production маршрут вимкнено назавжди — відповідає 404.
 */
export async function POST() {
  /**
   * У продакшні маршрут вимкнено. Виняток — прогін E2E на прод-збірці:
   * `next start` виставляє NODE_ENV=production, і без цього тести не можуть
   * привести демо-користувача до відомого стану.
   *
   * Виняток навмисно подвійний. Мало ввімкнути змінну — скидати можна ЛИШЕ
   * демо-користувача. Навіть якщо змінна колись потрапить на сервер через
   * недогляд, дані живої людини лишаться недоторканими: seedDemoUser пише
   * в того користувача, який зайшов, і без цієї межі помилка в конфізі
   * коштувала б комусь його комори.
   */
  const testReset = process.env.E2E_TEST_RESET === 'true'
  if (process.env.NODE_ENV === 'production' && !testReset) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const userId = (await getUserId()) ?? 'demo-user'
    if (testReset && userId !== 'demo-user') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    /**
     * Демо-користувач має лишатись демонстраційним ЗАВЖДИ.
     * Якщо до нього прив'язана жива MCP-сесія, тести починають ходити
     * в реальний «Сільпо» і падають на бейджі DEMO MODE. Тому відв'язуємо
     * токен саме від demo-user — сесії інших користувачів не чіпаємо.
     */
    if (userId === 'demo-user') {
      await prisma.mcpSession.deleteMany({ where: { userId } })
      await prisma.user.updateMany({ where: { id: userId }, data: { authMode: 'demo' } })
    }

    await resetDemoCart(userId)
    await seedRecipes(prisma)
    const result = await seedDemoUser(prisma, userId)
    return NextResponse.json({ ok: true, userId, ...result })
  } catch (err) {
    return errorResponse(err)
  }
}
