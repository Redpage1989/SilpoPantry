import type { PrismaClient } from '@prisma/client'
import { SEED_RECIPES } from './recipes'
import { normalizeProductName, guessCategory } from '@/lib/domain/normalize'
import { seedActivity } from './activity'

/**
 * Наповнення demo-даними. Винесено в бібліотеку, щоб один і той самий код
 * використовували і `npm run db:seed`, і dev-ендпойнт скидання для E2E.
 *
 * Дані вигадані: жодних реальних персональних даних, телефонів, адрес
 * чи номерів карток тут немає і бути не може.
 */

export const DEMO_USER_ID = 'demo-user'

interface SeedPantryRow {
  originalName: string
  quantity: number
  unit: string
  /** null — термін невідомий */
  expiryInDays: number | null
  source: string
  confidence: number
  needsConfirmation: boolean
}

/** Демо-комора з ТЗ. Дати відносні, щоб демонстрація не «протухала». */
export const DEMO_PANTRY: SeedPantryRow[] = [
  { originalName: 'Яйця курячі С1', quantity: 6, unit: 'шт', expiryInDays: 14, source: 'offline_receipt', confidence: 0.6, needsConfirmation: true },
  { originalName: 'Молоко 2,5%', quantity: 0.7, unit: 'л', expiryInDays: 4, source: 'offline_receipt', confidence: 0.55, needsConfirmation: true },
  { originalName: 'Масло вершкове 72,6%', quantity: 120, unit: 'г', expiryInDays: 9, source: 'offline_receipt', confidence: 0.5, needsConfirmation: true },
  { originalName: 'Помідори червоні', quantity: 3, unit: 'шт', expiryInDays: 3, source: 'photo', confidence: 0.82, needsConfirmation: false },
  // ключовий продукт демонстрації: використати до завтра
  { originalName: 'Шпинат свіжий', quantity: 150, unit: 'г', expiryInDays: 1, source: 'photo', confidence: 0.71, needsConfirmation: false },
  { originalName: 'Макарони Спагеті', quantity: 400, unit: 'г', expiryInDays: 240, source: 'offline_receipt', confidence: 0.7, needsConfirmation: false },
  { originalName: 'Сир Маскарпоне 78%', quantity: 250, unit: 'г', expiryInDays: 6, source: 'offline_receipt', confidence: 0.6, needsConfirmation: true },
  { originalName: 'Кава мелена', quantity: 200, unit: 'г', expiryInDays: 300, source: 'offline_receipt', confidence: 0.65, needsConfirmation: false },
  { originalName: 'Цукор білий кристалічний', quantity: 800, unit: 'г', expiryInDays: 400, source: 'offline_receipt', confidence: 0.65, needsConfirmation: false },
]

function daysFromNow(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(23, 59, 59, 0)
  return d
}

export async function seedRecipes(prisma: PrismaClient): Promise<number> {
  for (const r of SEED_RECIPES) {
    await prisma.recipe.upsert({
      where: { slug: r.slug },
      update: {},
      create: {
        id: r.id,
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        servings: r.servings,
        cookingTime: r.cookingTime,
        difficulty: r.difficulty,
        cuisine: r.cuisine,
        mealType: r.mealType,
        ingredients: JSON.stringify(r.ingredients),
        steps: JSON.stringify(r.steps),
        nutrition: JSON.stringify(r.nutrition),
        tags: JSON.stringify(r.tags),
        imageEmoji: r.imageEmoji,
        source: 'seed',
      },
    })
  }
  return SEED_RECIPES.length
}

/** Повне перестворення демо-родини та її комори. Ідемпотентне. */
export async function seedDemoUser(prisma: PrismaClient, userId = DEMO_USER_ID) {
  await prisma.pantryItem.deleteMany({ where: { userId } })
  await prisma.foodRestriction.deleteMany({ where: { userId } })
  await prisma.householdMember.deleteMany({ where: { userId } })
  await prisma.shoppingProposal.deleteMany({ where: { userId } })
  await prisma.recognitionJob.deleteMany({ where: { userId } })
  await prisma.receiptImport.deleteMany({ where: { userId } })

  /**
   * Бюджет на трьох, а не на одного. Було 250 грн на тиждень — на родину з
   * трьох осіб і трьох прийомів їжі це ≈12 грн на людину в день, і справа не
   * лише в правдоподібності: ліміт витрачається наростаючим підсумком
   * (див. mealplan.ts), тож він вичерпувався на першій же страві, і решту
   * тижня планувальник працював у аварійному режимі «мінімальна докупівля».
   * Демонстрація показувала запасний шлях замість основного.
   *
   * 2 000 грн лишають запас над докупівлею тижневого раціону (≈1 100 грн на
   * поточній коморі), але не роблять ліміт формальністю.
   */
  const profile = {
    displayName: 'Антон',
    authMode: 'demo',
    weeklyBudget: 2_000_00,
    mealsPerDay: 3,
    maxCookMinutes: 40,
    onboardedAt: new Date(),
  }
  await prisma.user.upsert({
    where: { id: userId },
    update: profile,
    create: { id: userId, ...profile },
  })

  await prisma.householdMember.create({
    data: { userId, name: 'Антон', type: 'adult', age: 36, preferences: JSON.stringify(['паста', 'кава']) },
  })
  await prisma.householdMember.create({
    data: { userId, name: 'Олена', type: 'adult', age: 34, preferences: JSON.stringify(['овочі']) },
  })
  const marko = await prisma.householdMember.create({
    data: { userId, name: 'Марко', type: 'child', age: 8, preferences: JSON.stringify(['макарони', 'сир']) },
  })

  // За ТЗ: алергій немає, дитина не любить гостре
  await prisma.foodRestriction.create({
    data: {
      userId,
      memberId: marko.id,
      restrictionType: 'dislike',
      value: 'гостре',
      severity: 'medium',
      note: 'Дитина не любить гостре',
    },
  })

  for (const row of DEMO_PANTRY) {
    const normalizedName = normalizeProductName(row.originalName)
    const guess = guessCategory(normalizedName)
    await prisma.pantryItem.create({
      data: {
        userId,
        normalizedName,
        originalName: row.originalName,
        category: guess.category,
        quantity: row.quantity,
        unit: row.unit,
        expiryDate: row.expiryInDays === null ? null : daysFromNow(row.expiryInDays),
        storageLocation: guess.storageLocation,
        source: row.source,
        confidence: row.confidence,
        needsConfirmation: row.needsConfirmation,
      },
    })
  }

  /**
   * Історія користування — частина демо-родини, а не окремий сідер: без неї
   * екран «Що змінилось» показує чотири прочерки, і людина не розуміє, що
   * саме застосунок міряє.
   */
  const activity = await seedActivity(prisma, userId)

  return { members: 3, restrictions: 1, pantry: DEMO_PANTRY.length, activity }
}
