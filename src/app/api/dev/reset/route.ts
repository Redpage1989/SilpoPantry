import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resetDemoCart } from '@/lib/mcp/mock-adapter'
import { seedDemoUser, seedRecipes } from '@/lib/seed/demo'
import { seedCommunity } from '@/lib/seed/community'
import { errorResponse } from '@/lib/api'
import { getUserId, rateLimit } from '@/lib/session'

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
  /**
   * Маршрут свідомо працює без сесії (перший виклик E2E ще не має куки),
   * тож зазвичайний handle() із CSRF тут не підходить. Але без жодного
   * ліміту той, хто знайшов би маршрут з увімкненим флагом, міг би скидати
   * демо-стан у циклі посеред показу журі. Глобальний ліміт це закриває,
   * а тестам вистачає з запасом: у прогоні 8 скидань за ~хвилину.
   */
  if (!rateLimit('dev-reset-global', 30)) {
    return NextResponse.json({ error: 'Забагато запитів' }, { status: 429 })
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

    /**
     * Рецепти, написані демо-користувачем, теж скидаються — але тільки його
     * власні: рецепти вигаданих родин зі стрічки лишаються на місці.
     * Без цього кожен прогін E2E лишав по чернетці, і наступний падав на
     * двох однакових заголовках у стрічці.
     *
     * Свідомо саме тут, а не в seedDemoUser: той викликається ще й при вході
     * в демо з порожньою коморою, і видаляти там чийсь щойно написаний
     * рецепт було б несподіванкою.
     */
    if (userId === 'demo-user') {
      await prisma.userRecipe.deleteMany({ where: { authorId: userId } })
    }

    await resetDemoCart(userId)
    await seedRecipes(prisma)
    const result = await seedDemoUser(prisma, userId)
    /**
     * Стрічка спільноти теж належить до «відомого стану». Без неї скидання
     * давало картину, якої людина при вході ніколи не бачить: комора повна,
     * а рецептів від інших родин немає — і тест на скарги не мав на що
     * скаржитись.
     */
    const community = await seedCommunity(prisma)
    return NextResponse.json({ ok: true, userId, ...result, community })
  } catch (err) {
    return errorResponse(err)
  }
}
