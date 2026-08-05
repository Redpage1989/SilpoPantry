import { prisma } from '@/lib/db'
import { sanitizeForTrace, logEvent } from '@/lib/mcp/pii'
import { formatUah } from '@/lib/domain/scoring'
import { effectivePrice } from '@/lib/domain/pricing'
import { SEED_RECIPES } from '@/lib/seed/recipes'
import type { HouseholdContext, PantryEntry, RecipeLike, Kopiyky } from '@/lib/domain/types'
import type { ScoredRecipe } from '@/lib/domain/scoring'
import {
  createToolContext,
  getHouseholdContext,
  getFoodRestrictions,
  getPantryInventory,
  findExpiringProductsTool,
  generateRecipeOptions,
  calculateMissingIngredientsTool,
  searchSilpoProducts,
  compareProductOptions,
  compareCookVsReadyMeal,
  createShoppingProposal,
  getCartSummary,
  type ProposalLine,
  type ToolContext,
  type TraceStep,
} from './tools'

/**
 * FamilyFoodAgent — оркестратор.
 *
 * Він не «чат із моделлю»: він будує ЯВНИЙ план із типізованих інструментів
 * і виконує його крок за кроком. Це навмисно — план можна показати журі,
 * відтворити й перевірити, а кожен крок лишає запис у безпечному трейсі.
 *
 * Модель тут відповідає за те, що вона робить добре (розпізнавання фото,
 * природна мова), а за гроші, кошик і алергії відповідає детермінований код.
 */

export interface PlanStep {
  n: number
  tool: string
  why: string
}

export interface AgentResult<T> {
  runId: string
  goal: string
  plan: PlanStep[]
  trace: TraceStep[]
  mode: 'live' | 'mock'
  modeReason: string
  liveMcpCalls: number
  durationMs: number
  data: T
}

async function runAgent<T>(
  userId: string,
  goal: string,
  plan: PlanStep[],
  body: (ctx: ToolContext) => Promise<T>,
): Promise<AgentResult<T>> {
  const started = Date.now()
  const ctx = await createToolContext(userId)
  const run = await prisma.agentRun.create({
    data: { userId, goal, status: 'running', safeTrace: '[]' },
  })

  try {
    const data = await body(ctx)
    const durationMs = Date.now() - started
    const liveMcpCalls = countLiveCalls(ctx.trace)
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'done',
        safeTrace: JSON.stringify(sanitizeForTrace({ plan, steps: ctx.trace })),
        liveMcpCalls,
        durationMs,
      },
    })
    logEvent('info', 'agent.run_done', { goal, steps: ctx.trace.length, liveMcpCalls, durationMs })
    return {
      runId: run.id,
      goal,
      plan,
      trace: ctx.trace,
      mode: ctx.adapter.mode,
      modeReason: ctx.adapterReason,
      liveMcpCalls,
      durationMs,
      data,
    }
  } catch (err) {
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        safeTrace: JSON.stringify(sanitizeForTrace({ plan, steps: ctx.trace })),
        durationMs: Date.now() - started,
      },
    })
    logEvent('error', 'agent.run_failed', { goal, message: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

function countLiveCalls(trace: TraceStep[]): number {
  return trace.reduce((sum, s) => sum + (s.mcpCalls ?? []).filter((c) => c.mode === 'live').length, 0)
}

// ─────────────────────────── Сценарій A: головна ───────────────────────────

export interface DashboardData {
  household: HouseholdContext
  pantry: PantryEntry[]
  expiring: PantryEntry[]
  suggestions: ScoredRecipe[]
  daysOfFood: number
  cart: Awaited<ReturnType<typeof getCartSummary>>['cart']
  promos: { promoId: string; title: string }[]
  loyalty: { balabonuses: number; level?: string }
  restock: { name: string; reason: string }[]
}

export async function runDashboard(userId: string): Promise<AgentResult<DashboardData>> {
  const plan: PlanStep[] = [
    { n: 1, tool: 'getHouseholdContext', why: 'Дізнатись склад родини, бюджет і ліміт часу' },
    { n: 2, tool: 'getPantryInventory', why: 'Прочитати актуальні домашні залишки' },
    { n: 3, tool: 'findExpiringProducts', why: 'Знайти те, що треба спожити найближчим часом' },
    { n: 4, tool: 'generateRecipeOptions', why: 'Підібрати страви під наявні продукти' },
    { n: 5, tool: 'getCartSummary', why: 'Показати стан кошика, акції та балабонуси' },
  ]

  return runAgent(userId, 'Показати головний екран із персональними рекомендаціями', plan, async (ctx) => {
    const household = await getHouseholdContext(ctx)
    const pantry = await getPantryInventory(ctx)
    const expiring = await findExpiringProductsTool(ctx, 5)
    const suggestions = await generateRecipeOptions(
      ctx,
      { rescueMode: expiring.length > 0, limit: 3, servings: household.members.length },
      household,
      pantry,
    )
    const { cart, loyalty } = await getCartSummary(ctx)
    const promos = await ctx.adapter.getPromos().catch(() => [])
    ctx.adapter.drainTrace()

    const { estimateDaysOfFood } = await import('@/lib/domain/pantry')
    const daysOfFood = estimateDaysOfFood(pantry, household.members.length, household.mealsPerDay)

    return {
      household,
      pantry,
      expiring,
      suggestions,
      daysOfFood,
      cart,
      promos: promos.map((p) => ({ promoId: p.promoId, title: p.title })),
      loyalty,
      restock: buildRestockList(pantry, suggestions),
    }
  })
}

/** Що варто докупити: базові продукти, яких мало або немає. */
function buildRestockList(pantry: PantryEntry[], suggestions: ScoredRecipe[]): { name: string; reason: string }[] {
  const staples = ['молоко', 'яйця', 'хліб', 'олія', 'цукор', 'борошно', 'масло вершкове']
  const have = new Set(pantry.map((p) => p.normalizedName))
  const out: { name: string; reason: string }[] = []

  for (const staple of staples) {
    if (!have.has(staple)) out.push({ name: staple, reason: 'Базовий продукт закінчився' })
  }
  for (const s of suggestions) {
    for (const m of s.coverage.missing.filter((x) => !x.optional).slice(0, 2)) {
      if (!out.some((o) => o.name === m.normalizedName)) {
        out.push({ name: m.normalizedName, reason: `Потрібно для страви «${s.recipe.title}»` })
      }
    }
  }
  return out.slice(0, 6)
}

// ─────────────────────────── Сценарій B: що приготувати ───────────────────────────

export interface CookOptions {
  servings?: number
  mealType?: 'breakfast' | 'lunch' | 'dinner' | 'dessert' | 'snack'
  maxMinutes?: number
  maxBudget?: number
  difficulty?: 'easy' | 'medium' | 'hard'
  cuisine?: string
  rescueMode?: boolean
}

export async function runRecipeSuggestions(
  userId: string,
  options: CookOptions,
): Promise<AgentResult<{ suggestions: ScoredRecipe[]; household: HouseholdContext; expiring: PantryEntry[] }>> {
  const plan: PlanStep[] = [
    { n: 1, tool: 'getHouseholdContext', why: 'Врахувати кількість людей і час на готування' },
    { n: 2, tool: 'getFoodRestrictions', why: 'Виключити страви з алергенами та забороненими продуктами' },
    { n: 3, tool: 'getPantryInventory', why: 'Порахувати, що вже є вдома' },
    { n: 4, tool: 'findExpiringProducts', why: 'Підняти в рейтингу страви, що рятують продукти' },
    { n: 5, tool: 'generateRecipeOptions', why: 'Прозоро проскорити страви за 6 факторами' },
  ]

  return runAgent(userId, buildGoalText(options), plan, async (ctx) => {
    const household = await getHouseholdContext(ctx)
    await getFoodRestrictions(ctx)
    const pantry = await getPantryInventory(ctx)
    const expiring = await findExpiringProductsTool(ctx, 5)
    const suggestions = await generateRecipeOptions(ctx, { ...options, limit: 5 }, household, pantry)
    return { suggestions, household, expiring }
  })
}

function buildGoalText(o: CookOptions): string {
  const parts = ['Підібрати страву']
  if (o.mealType) parts.push({ breakfast: 'на сніданок', lunch: 'на обід', dinner: 'на вечерю', dessert: 'десерт', snack: 'на перекус' }[o.mealType])
  if (o.servings) parts.push(`на ${o.servings} ос.`)
  if (o.maxBudget) parts.push(`до ${formatUah(o.maxBudget)}`)
  if (o.maxMinutes) parts.push(`за ${o.maxMinutes} хв`)
  if (o.rescueMode) parts.push('з продуктів, що псуються')
  return parts.join(' ')
}

// ─────────────────────────── Сценарій C: «Хочу тірамісу» ───────────────────────────

export interface DishPlanData {
  recipe: RecipeLike
  scored: ScoredRecipe
  servings: number
  comparisons: Awaited<ReturnType<typeof compareProductOptions>>
  cookVsReady: Awaited<ReturnType<typeof compareCookVsReadyMeal>>
  proposal: { proposalId: string; confirmationToken: string; total: Kopiyky } | null
  totalsByTier: Record<string, Kopiyky>
}

/**
 * Повний ланцюжок «Хочу приготувати X»:
 * рецепт → порції → залишки → нестача → пошук у «Сільпо» → три цінові
 * варіанти → порівняння з готовим → пропозиція (БЕЗ зміни кошика).
 */
export async function runDishPlan(
  userId: string,
  params: { query: string; servings?: number },
): Promise<AgentResult<DishPlanData>> {
  const plan: PlanStep[] = [
    { n: 1, tool: 'getHouseholdContext', why: 'Скільки порцій і які обмеження в родини' },
    { n: 2, tool: 'getPantryInventory', why: 'Що з інгредієнтів уже є вдома' },
    { n: 3, tool: 'calculateMissingIngredients', why: 'Точно порахувати, чого не вистачає' },
    { n: 4, tool: 'searchSilpoProducts', why: 'Знайти відсутнє в каталозі «Сільпо» через MCP' },
    { n: 5, tool: 'compareProductOptions', why: 'Скласти бюджетний, оптимальний і преміальний варіанти' },
    { n: 6, tool: 'compareCookVsReadyMeal', why: 'Порівняти «приготувати вдома» з «купити готове»' },
    { n: 7, tool: 'createShoppingProposal', why: 'Підготувати пропозицію та чекати підтвердження користувача' },
  ]

  return runAgent(userId, `Хочу приготувати: ${params.query}`, plan, async (ctx) => {
    const household = await getHouseholdContext(ctx)
    const restrictions = await getFoodRestrictions(ctx)
    const pantry = await getPantryInventory(ctx)

    const recipe = findRecipeByQuery(params.query)
    if (!recipe) throw new Error(`Не вдалося знайти рецепт для запиту «${params.query}»`)

    const servings = params.servings ?? Math.max(recipe.servings, household.members.length)
    const coverage = await calculateMissingIngredientsTool(ctx, recipe, pantry, servings)
    const required = coverage.missing.filter((m) => !m.optional)

    const searchResults = required.length > 0 ? await searchSilpoProducts(ctx, required) : []
    const comparisons =
      required.length > 0 ? await compareProductOptions(ctx, required, searchResults, restrictions) : []

    const pantryValue = estimatePantryValue(recipe, coverage.have.length)
    const cookVsReady = await compareCookVsReadyMeal(ctx, {
      recipe,
      missingCost: totalForTier(comparisons, 'optimal') || coverage.approxMissingCost,
      missingCostConsumed: consumedForTier(comparisons, 'optimal') || coverage.approxMissingCost,
      pantryValue,
      desiredServings: servings,
      readyKey: normalizeReadyKey(recipe.title),
    })

    const lines = buildProposalLines(comparisons, 'optimal')
    const proposal =
      lines.length > 0
        ? await createShoppingProposal(ctx, {
            goal: `Приготувати «${recipe.title}» на ${servings} порцій`,
            recipeId: recipe.id,
            lines,
            missing: required.map((m) => ({ name: m.name, missing: m.missing, unit: m.unit })),
          })
        : null

    const { scoreRecipe } = await import('@/lib/domain/scoring')
    const scored = scoreRecipe(recipe, { pantry, household, servings, now: ctx.now })

    return {
      recipe,
      scored,
      servings,
      comparisons,
      cookVsReady,
      proposal,
      totalsByTier: {
        budget: totalForTier(comparisons, 'budget'),
        optimal: totalForTier(comparisons, 'optimal'),
        premium: totalForTier(comparisons, 'premium'),
      },
    }
  })
}

export function buildProposalLines(
  comparisons: Awaited<ReturnType<typeof compareProductOptions>>,
  tier: string,
): ProposalLine[] {
  const lines: ProposalLine[] = []
  for (const c of comparisons) {
    const chosen = c.tiers.find((t) => t.tier === tier) ?? c.tiers[0]
    if (!chosen) continue
    const safety = c.safety.find((s) => s.productId === chosen.product.productId)
    lines.push({
      ingredientName: c.ingredient.name,
      normalizedName: c.ingredient.normalizedName,
      productId: chosen.product.productId,
      companyId: chosen.product.companyId,
      branchId: chosen.product.branchId,
      productName: chosen.product.name,
      tier: chosen.tier,
      quantity: chosen.quantity,
      price: chosen.product.price,
      promoPrice: chosen.product.promoPrice,
      lineTotal: chosen.lineTotal,
      promoSaving: chosen.promoSaving,
      warnings: safety?.messages ?? [],
    })
  }
  return lines
}

function totalForTier(comparisons: Awaited<ReturnType<typeof compareProductOptions>>, tier: string): Kopiyky {
  return comparisons.reduce((sum, c) => {
    const t = c.tiers.find((x) => x.tier === tier) ?? c.tiers[0]
    return sum + (t ? t.lineTotal : 0)
  }, 0)
}

/** Скільки з оплаченого страва реально спожиє (решта лишається вдома). */
function consumedForTier(comparisons: Awaited<ReturnType<typeof compareProductOptions>>, tier: string): Kopiyky {
  return comparisons.reduce((sum, c) => {
    const t = c.tiers.find((x) => x.tier === tier) ?? c.tiers[0]
    return sum + (t ? t.consumedValue : 0)
  }, 0)
}

/** Груба оцінка вартості того, що вже є вдома — для чесного порівняння. */
function estimatePantryValue(recipe: RecipeLike, haveCount: number): Kopiyky {
  const perIngredient = 4000
  return haveCount * perIngredient + (recipe.servings > 4 ? 2000 : 0)
}

function normalizeReadyKey(title: string): string {
  return title.toLowerCase().trim()
}

/** Пошук рецепта за вільним текстом користувача. */
export function findRecipeByQuery(query: string): RecipeLike | null {
  const q = query.toLowerCase().trim()
  const exact = SEED_RECIPES.find((r) => r.title.toLowerCase() === q || r.slug === q)
  if (exact) return exact
  const partial = SEED_RECIPES.find((r) => q.includes(r.title.toLowerCase()) || r.title.toLowerCase().includes(q))
  if (partial) return partial
  const words = q.split(/\s+/).filter((w) => w.length > 3)
  const scored = SEED_RECIPES.map((r) => {
    const hay = `${r.title} ${r.summary} ${r.tags.join(' ')}`.toLowerCase()
    return { r, score: words.filter((w) => hay.includes(w)).length }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return scored[0]?.r ?? null
}

// ─────────────────────────── Сценарій D: кошик ───────────────────────────

export async function runCartOverview(userId: string) {
  const plan: PlanStep[] = [
    { n: 1, tool: 'getCartSummary', why: 'Отримати активний кошик, купони, слоти доставки' },
  ]
  return runAgent(userId, 'Показати кошик і підсумки', plan, async (ctx) => {
    const summary = await getCartSummary(ctx)
    const proposals = await prisma.shoppingProposal.findMany({
      where: { userId, status: 'draft' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    })
    return {
      ...summary,
      pendingProposals: proposals.map((p) => ({
        id: p.id,
        goal: p.goal,
        total: p.totalPrice,
        lines: (JSON.parse(p.selectedProducts) as ProposalLine[]).length,
        createdAt: p.createdAt.toISOString(),
      })),
    }
  })
}

export { effectivePrice }
