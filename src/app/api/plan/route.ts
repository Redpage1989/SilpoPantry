import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { runWeeklyPlan } from '@/lib/agent/orchestrator'
import { createToolContext, saveMealPlan } from '@/lib/agent/tools'
import type { WeeklyPlan } from '@/lib/domain/mealplan'

const GenerateInput = z.object({
  days: z.number().int().min(1).max(14).optional(),
  mealsPerDay: z.number().int().min(1).max(4).optional(),
  budget: z.number().int().min(0).nullable().optional(),
})

/** Побудова раціону на кілька днів. Кошик на цьому кроці не змінюється. */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10 }, async (userId) => {
    const input = GenerateInput.parse(await request.json())
    const run = await runWeeklyPlan(userId, input)
    return {
      mode: run.mode,
      modeReason: run.modeReason,
      // `agentPlan` — кроки агента, `plan` — сам раціон; імена не мають збігатися
      agentPlan: run.plan,
      trace: run.trace,
      durationMs: run.durationMs,
      liveMcpCalls: run.liveMcpCalls,
      ...run.data,
    }
  })
}

const SaveInput = z.object({
  days: z.array(
    z.object({
      dayOffset: z.number().int().min(0).max(13),
      date: z.string(),
      meals: z.array(
        z.object({
          mealType: z.enum(['breakfast', 'lunch', 'dinner', 'dessert', 'snack']),
          recipeId: z.string().min(1),
          servings: z.number().int().min(1).max(12),
        }),
      ),
    }),
  ),
})

/**
 * WRITE. Зберігає затверджений раціон у календар харчування.
 * Приймає лише ідентифікатори страв — сам план перебудовується на сервері,
 * щоб клієнт не міг записати те, чого агент не пропонував.
 */
export async function PUT(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10 }, async (userId) => {
    const input = SaveInput.parse(await request.json())
    const ctx = await createToolContext(userId)

    const plan: WeeklyPlan = {
      days: input.days.map((d) => ({
        dayOffset: d.dayOffset,
        date: new Date(d.date),
        isWeekend: [0, 6].includes(new Date(d.date).getDay()),
        meals: d.meals.map((m) => ({
          mealType: m.mealType,
          // до бази йде лише recipeId, тож достатньо мінімального обʼєкта
          recipe: { id: m.recipeId } as WeeklyPlan['days'][number]['meals'][number]['recipe'],
          servings: m.servings,
          missing: [],
          missingCost: 0,
          rescues: [],
          reason: '',
          coverage: 0,
        })),
      })),
      shoppingList: [],
      totalMissingCost: 0,
      rescuedProducts: [],
      atRiskProducts: [],
      budget: { limit: null, planned: 0, withinBudget: true },
      unfilledSlots: 0,
    }

    const result = await saveMealPlan(ctx, { plan, confirmationToken: randomBytes(12).toString('base64url') })
    return { ...result, trace: ctx.trace }
  })
}

/** Збережений раціон користувача. */
export async function GET(request: Request) {
  return handle(request, {}, async (userId) => {
    const rows = await prisma.mealPlan.findMany({
      where: { userId },
      orderBy: [{ date: 'asc' }],
      include: { recipe: true },
    })
    return {
      meals: rows.map((r) => ({
        date: r.date.toISOString(),
        mealType: r.mealType,
        status: r.status,
        servings: r.servings,
        title: r.recipe.title,
        slug: r.recipe.slug,
        imageEmoji: r.recipe.imageEmoji,
      })),
    }
  })
}
