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
    const [meals, eaten, wasted, proposals, addedToCart, first] = await Promise.all([
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
       * Точка відліку — найстаріша позиція комори, а не дата створення
       * акаунта: демо-користувач існує з першого деплою, і від нього
       * «днів користування» рахувалися б місяцями без жодної дії.
       */
      prisma.pantryItem.findFirst({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ])

    const daysObserved = first
      ? Math.floor((Date.now() - first.createdAt.getTime()) / 86_400_000)
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
