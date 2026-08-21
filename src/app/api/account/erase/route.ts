import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { clearSession } from '@/lib/session'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Видалення всіх даних користувача.
 *
 * Політика приватності обіцяє можливість видалити історію — обіцянка має
 * бути виконуваною однією кнопкою, а не листом у підтримку.
 *
 * Раніше тут перелічувались сім таблиць, і цей перелік мовчки застарів:
 * користувачу належать тринадцять. Виживали, зокрема, `FoodRestriction`
 * (алергії — дані про здоровʼя), `HouseholdMember` (імена членів родини,
 * включно з дитиною) і `UserRecipe` (публічні рецепти в стрічці). Кнопка
 * казала «стерти все, що застосунок про вас знає», і це була неправда.
 *
 * Тому тепер видаляється сам обліковий запис: шістнадцять каскадів у схемі
 * прибирають усе, що на нього посилається, і жоден новий зв'язок не може
 * загубитись через те, що його забули дописати в перелік.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 5 }, async (userId) => {
    // рахуємо ДО видалення: після каскаду рахувати вже нічого
    const [pantry, jobs, proposals, runs, plans, imports, recipes, votes, members, restrictions] =
      await prisma.$transaction([
        prisma.pantryItem.count({ where: { userId } }),
        prisma.recognitionJob.count({ where: { userId } }),
        prisma.shoppingProposal.count({ where: { userId } }),
        prisma.agentRun.count({ where: { userId } }),
        prisma.mealPlan.count({ where: { userId } }),
        prisma.receiptImport.count({ where: { userId } }),
        prisma.userRecipe.count({ where: { authorId: userId } }),
        prisma.recipeVote.count({ where: { voterId: userId } }),
        prisma.householdMember.count({ where: { userId } }),
        prisma.foodRestriction.count({ where: { userId } }),
      ])

    await prisma.user.delete({ where: { id: userId } })

    /**
     * Сесія вказує на обліковий запис, якого більше немає. Якщо її не
     * прибрати, людина далі ходить застосунком із «привидом» у куці й
     * отримує помилки замість чистого старту.
     */
    await clearSession()

    logEvent('info', 'account.erased', {})
    return {
      loggedOut: true,
      erased: {
        pantry,
        recognitions: jobs,
        proposals,
        agentRuns: runs,
        mealPlans: plans,
        receiptImports: imports,
        userRecipes: recipes,
        votes,
        householdMembers: members,
        foodRestrictions: restrictions,
      },
    }
  })
}
