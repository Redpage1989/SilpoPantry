import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { buildMetrics } from '@/lib/domain/metrics'

/**
 * Метрики, які пітч називає вголос.
 *
 * Усе рахується з подій самого користувача — жодних середніх по ринку й
 * жодних чисел «з дослідження». Порожній стан теж чесний: замість нулів
 * картка каже, скількох подій бракує.
 */
export async function GET(request: Request) {
  return handle(request, {}, async (userId) => {
    const [meals, eaten, wasted, proposals, addedToCart, first, firstMeal] = await Promise.all([
      prisma.cookedMeal.findMany({
        where: { userId },
        select: { fromPantry: true, total: true },
        orderBy: { cookedAt: 'desc' },
        take: 100,
      }),
      prisma.pantryItem.count({ where: { userId, disposal: 'eaten' } }),
      prisma.pantryItem.count({ where: { userId, disposal: 'wasted' } }),
      prisma.shoppingProposal.count({ where: { userId } }),
      prisma.shoppingProposal.count({ where: { userId, status: 'added_to_cart' } }),
      /**
       * Точка відліку — найстаріша ПОДІЯ, а не дата створення акаунта:
       * демо-користувач існує з першого деплою, і від нього «днів
       * користування» рахувалися б місяцями без жодної дії.
       *
       * Беремо і комору, і приготовані страви: історія на два тижні поруч із
       * «днів користування: 0» виглядала б як помилка.
       */
      prisma.pantryItem.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      prisma.cookedMeal.findFirst({
        where: { userId },
        orderBy: { cookedAt: 'asc' },
        select: { cookedAt: true },
      }),
    ])

    const startedAt = [first?.createdAt, firstMeal?.cookedAt]
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime())[0]
    const daysObserved = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 86_400_000)
      : 0

    return {
      metrics: buildMetrics({
        cooked: meals,
        disposals: { eaten, wasted },
        proposals: { total: proposals, addedToCart },
        daysObserved,
      }),
      daysObserved,
    }
  })
}
