import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Видалення всіх даних користувача.
 *
 * Політика приватності обіцяє можливість видалити історію — обіцянка має
 * бути виконуваною однією кнопкою, а не листом у підтримку.
 * Видаляється все: токени, комора, розпізнавання, пропозиції, трейси.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 5 }, async (userId) => {
    const [tokens, pantry, jobs, proposals, runs, plans, imports] = await prisma.$transaction([
      prisma.mcpSession.deleteMany({ where: { userId } }),
      prisma.pantryItem.deleteMany({ where: { userId } }),
      prisma.recognitionJob.deleteMany({ where: { userId } }),
      prisma.shoppingProposal.deleteMany({ where: { userId } }),
      prisma.agentRun.deleteMany({ where: { userId } }),
      prisma.mealPlan.deleteMany({ where: { userId } }),
      prisma.receiptImport.deleteMany({ where: { userId } }),
    ])
    logEvent('info', 'account.erased', {})
    return {
      erased: {
        tokens: tokens.count,
        pantry: pantry.count,
        recognitions: jobs.count,
        proposals: proposals.count,
        agentRuns: runs.count,
        mealPlans: plans.count,
        receiptImports: imports.count,
      },
    }
  })
}
