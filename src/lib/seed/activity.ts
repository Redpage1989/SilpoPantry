import type { PrismaClient } from '@prisma/client'
import { normalizeProductName, guessCategory } from '@/lib/domain/normalize'

/**
 * Історія користування демо-родини: приготовані страви, спожите й викинуте,
 * пропозиції кошика.
 *
 * Без неї екран «Що змінилось» на свіжому демо показує чотири прочерки. Це
 * чесно, але людині, яка відкриває демо на п'ять хвилин, нема з чого зрозуміти,
 * ЩО саме застосунок міряє: порожня картка виглядає як нереалізований розділ.
 *
 * Важлива межа: сіються ПОДІЇ, а не метрики. Числа на екрані рахуються з цих
 * подій тим самим кодом, що й для живого користувача, — ніде не лежить
 * записаних «72%». Прибрати події означає повернути прочерки, і це правильно.
 *
 * Дані вигадані, як і решта демо: родина Антона нібито готує два тижні.
 * Показники навмисно не ідеальні — 100% скрізь виглядало б як реклама, а не
 * як вимірювання.
 */

/**
 * Покриття коморою по кожній приготованій страві: скільки інгредієнтів
 * знайшлось удома з усіх обовʼязкових. Середнє ≈ 72% — правдоподібно для
 * родини, яка веде комору, але не планує кожну вечерю.
 */
const COOKED: { slug: string; title: string; fromPantry: number; total: number; daysAgo: number }[] = [
  { slug: 'frittata-shpynat', title: 'Фрітата зі шпинатом', fromPantry: 5, total: 5, daysAgo: 13 },
  { slug: 'pasta-shpynat-pomidory', title: 'Паста зі шпинатом і помідорами', fromPantry: 3, total: 5, daysAgo: 12 },
  { slug: 'kuryache-file-ovochi', title: 'Куряче філе з овочами', fromPantry: 4, total: 6, daysAgo: 11 },
  { slug: 'vivsyanka-frukty', title: 'Вівсянка з фруктами', fromPantry: 2, total: 4, daysAgo: 10 },
  { slug: 'omlet-syr', title: 'Омлет із сиром', fromPantry: 4, total: 4, daysAgo: 9 },
  { slug: 'grechka-hryby', title: 'Гречка з грибами', fromPantry: 3, total: 6, daysAgo: 8 },
  { slug: 'syrnyky', title: 'Сирники', fromPantry: 4, total: 5, daysAgo: 7 },
  { slug: 'sup-kuryachyi', title: 'Курячий суп', fromPantry: 5, total: 7, daysAgo: 6 },
  { slug: 'deruny', title: 'Деруни', fromPantry: 2, total: 5, daysAgo: 5 },
  { slug: 'zapikanka-syr', title: 'Запіканка сирна', fromPantry: 4, total: 4, daysAgo: 3 },
  { slug: 'salat-ovochevyi', title: 'Овочевий салат', fromPantry: 3, total: 4, daysAgo: 2 },
  { slug: 'pasta-karbonara', title: 'Паста карбонара', fromPantry: 5, total: 6, daysAgo: 1 },
]

/** Спожите вчасно: пішло у страви й не зіпсувалось. */
const EATEN = [
  'Молоко 2,5%', 'Яйця курячі С1', 'Шпинат свіжий', 'Помідори червоні', 'Сир твердий',
  'Куряче філе', 'Гречка', 'Макарони Спагеті', 'Масло вершкове 72,6%', 'Цибуля ріпчаста',
  'Морква', 'Картопля', 'Сметана 20%', 'Йогурт натуральний', 'Хліб пшеничний',
  'Кабачки', 'Гриби печериці', 'Сир кисломолочний',
]

/**
 * Викинуте. Три позиції на вісімнадцять спожитих — це 14% втрат, приблизно
 * стільки й називають дослідження харчових відходів домогосподарств.
 * Ставити нуль було б брехнею: родина, яка нічого не викидає, не існує.
 */
const WASTED = ['Салат айсберг', 'Кефір 2,5%', 'Петрушка']

/** Пропозиції кошика: скільки агент показав і скільки людина підтвердила. */
const PROPOSALS: { goal: string; total: number; addedToCart: boolean; daysAgo: number }[] = [
  { goal: 'Вечеря на двох', total: 18_400, addedToCart: true, daysAgo: 12 },
  { goal: 'Тірамісу на 6 порцій', total: 13_800, addedToCart: true, daysAgo: 10 },
  { goal: 'Раціон на тиждень', total: 111_380, addedToCart: false, daysAgo: 9 },
  { goal: 'Сніданки на три дні', total: 9_600, addedToCart: true, daysAgo: 7 },
  { goal: 'Куряче філе з овочами', total: 16_200, addedToCart: true, daysAgo: 6 },
  { goal: 'Вечеря на двох', total: 14_050, addedToCart: false, daysAgo: 4 },
  { goal: 'Паста карбонара', total: 11_900, addedToCart: true, daysAgo: 3 },
  { goal: 'Раціон на тиждень', total: 98_700, addedToCart: false, daysAgo: 2 },
  { goal: 'Запіканка сирна', total: 8_450, addedToCart: true, daysAgo: 1 },
]

function daysAgo(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 86_400_000)
}

/** Форма сідованої історії — для тесту, який стереже правдоподібність чисел. */
export const COOKED_SEED = COOKED.map((c) => ({ fromPantry: c.fromPantry, total: c.total }))
export const EATEN_SEED = EATEN.length
export const WASTED_SEED = WASTED.length
export const PROPOSALS_SEED = PROPOSALS.map((p) => p.addedToCart)

/**
 * Ідемпотентна: спершу прибирає власні сліди, потім створює наново. Викликається
 * із `seedDemoUser`, тож повторний seed не подвоює історію.
 */
export async function seedActivity(prisma: PrismaClient, userId: string, now = new Date()) {
  await prisma.cookedMeal.deleteMany({ where: { userId } })
  await prisma.pantryItem.deleteMany({ where: { userId, disposal: { not: null } } })
  await prisma.shoppingProposal.deleteMany({ where: { userId } })

  for (const m of COOKED) {
    await prisma.cookedMeal.create({
      data: {
        userId,
        recipeSlug: m.slug,
        title: m.title,
        servings: 3,
        fromPantry: m.fromPantry,
        total: m.total,
        cookedAt: daysAgo(m.daysAgo, now),
      },
    })
  }

  /**
   * Спожите й викинуте — це рядки комори, які її вже покинули: quantity 0 і
   * проставлений consumedAt. Вони не показуються у списку (див. loadPantry),
   * але лишаються історією, з якої рахується метрика втрат.
   */
  const leave = async (names: string[], disposal: 'eaten' | 'wasted', offset: number) => {
    for (const [i, originalName] of names.entries()) {
      const normalizedName = normalizeProductName(originalName)
      const guess = guessCategory(normalizedName)
      await prisma.pantryItem.create({
        data: {
          userId,
          normalizedName,
          originalName,
          category: guess.category,
          quantity: 0,
          unit: 'шт',
          storageLocation: guess.storageLocation,
          source: 'offline_receipt',
          confidence: 0.7,
          needsConfirmation: false,
          consumedAt: daysAgo((i % 12) + offset, now),
          disposal,
          createdAt: daysAgo((i % 12) + offset + 5, now),
        },
      })
    }
  }
  await leave(EATEN, 'eaten', 1)
  await leave(WASTED, 'wasted', 2)

  for (const [i, p] of PROPOSALS.entries()) {
    await prisma.shoppingProposal.create({
      data: {
        userId,
        goal: p.goal,
        missingIngredients: '[]',
        selectedProducts: '[]',
        totalPrice: p.total,
        status: p.addedToCart ? 'added_to_cart' : 'draft',
        confirmationToken: `demo-history-${i}-${userId}`,
        createdAt: daysAgo(p.daysAgo, now),
      },
    })
  }

  return {
    cooked: COOKED.length,
    eaten: EATEN.length,
    wasted: WASTED.length,
    proposals: PROPOSALS.length,
  }
}
