import { z } from 'zod'
import { prisma } from '@/lib/db'
import { resolveAdapterSafe, type SilpoAdapter, type McpTraceEntry } from '@/lib/mcp'
import { MockSilpoAdapter } from '@/lib/mcp/mock-adapter'
import { analyzePantryPhotos, enrichRecognizedItem, type PhotoInput } from '@/lib/ai/vision'
import { inferPantryFromReceipts } from '@/lib/domain/receipts'
import { calculateMissingIngredients } from '@/lib/domain/matching'
import { rankRecipes, formatUah } from '@/lib/domain/scoring'
import { buildTiers, compareCookVsReady, sumBasket, estimateServingsPerPack, cartQuantity } from '@/lib/domain/pricing'
import { findExpiringProducts, planDeduction, estimateDaysOfFood, expiryStatus } from '@/lib/domain/pantry'
import { checkProductAgainstRestrictions } from '@/lib/domain/restrictions'
import { SEED_RECIPES } from '@/lib/seed/recipes'
import { buildWeeklyPlan, countMeals, describePlan, type WeeklyPlan } from '@/lib/domain/mealplan'
import { normalizeProductName, displayName } from '@/lib/domain/normalize'
import type {
  HouseholdContext,
  PantryEntry,
  ProductOption,
  RecipeLike,
  Restriction,
  StorageLocation,
  Unit,
  PantrySource,
} from '@/lib/domain/types'
import { randomBytes } from 'node:crypto'

/**
 * Інструменти агента FamilyFoodAgent.
 *
 * Кожен інструмент — це:
 *   · Zod-схема входу (валідується перед виконанням),
 *   · чиста або майже чиста функція над БД/адаптером,
 *   · запис у безпечний трейс.
 *
 * Write-інструменти (`updatePantryInventory`, `addConfirmedItemsToCart`)
 * приймають `confirmationToken`. Без валідного токена вони кидають помилку —
 * агент фізично не може змінити кошик користувача без його згоди.
 */

export interface ToolContext {
  userId: string
  adapter: SilpoAdapter
  adapterReason: string
  now: Date
  trace: TraceStep[]
}

export interface TraceStep {
  index: number
  tool: string
  status: 'ok' | 'error'
  durationMs: number
  summary: string
  input?: unknown
  output?: unknown
  mcpCalls?: McpTraceEntry[]
}

export class ConfirmationRequiredError extends Error {
  constructor(message = 'Ця дія потребує явного підтвердження користувача') {
    super(message)
    this.name = 'ConfirmationRequiredError'
  }
}

export async function createToolContext(userId: string, now = new Date()): Promise<ToolContext> {
  const { adapter, reason } = await resolveAdapterSafe(userId)
  return { userId, adapter, adapterReason: reason, now, trace: [] }
}

async function step<T>(
  ctx: ToolContext,
  tool: string,
  input: unknown,
  fn: () => Promise<{ result: T; summary: string; output?: unknown }>,
): Promise<T> {
  const started = Date.now()
  try {
    const { result, summary, output } = await fn()
    ctx.trace.push({
      index: ctx.trace.length + 1,
      tool,
      status: 'ok',
      durationMs: Date.now() - started,
      summary,
      input,
      output,
      mcpCalls: ctx.adapter.drainTrace(),
    })
    return result
  } catch (err) {
    ctx.trace.push({
      index: ctx.trace.length + 1,
      tool,
      status: 'error',
      durationMs: Date.now() - started,
      summary: err instanceof Error ? err.message : String(err),
      input,
      mcpCalls: ctx.adapter.drainTrace(),
    })
    throw err
  }
}

// ─────────────────────────── 1. Контекст родини ───────────────────────────

export const GetHouseholdContextInput = z.object({})

export async function getHouseholdContext(ctx: ToolContext): Promise<HouseholdContext> {
  return step(ctx, 'getHouseholdContext', {}, async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.userId },
      include: { members: true, restrictions: true },
    })
    const memberById = new Map(user.members.map((m) => [m.id, m.name]))
    const household: HouseholdContext = {
      displayName: user.displayName,
      members: user.members.map((m) => ({
        name: m.name,
        type: m.type as 'adult' | 'child' | 'teen' | 'senior',
        age: m.age ?? undefined,
        preferences: safeJsonArray(m.preferences),
      })),
      restrictions: user.restrictions.map((r) => ({
        restrictionType: r.restrictionType as Restriction['restrictionType'],
        value: r.value,
        severity: r.severity as Restriction['severity'],
        memberName: r.memberId ? memberById.get(r.memberId) : undefined,
      })),
      weeklyBudget: user.weeklyBudget,
      mealsPerDay: user.mealsPerDay,
      maxCookMinutes: user.maxCookMinutes,
    }
    return {
      result: household,
      summary: `Родина: ${household.members.length} ос., обмежень: ${household.restrictions.length}, бюджет: ${household.weeklyBudget ? formatUah(household.weeklyBudget) : 'не задано'}`,
      output: {
        members: household.members.map((m) => ({ type: m.type, age: m.age })),
        restrictionTypes: household.restrictions.map((r) => r.restrictionType),
      },
    }
  })
}

export async function getFoodRestrictions(ctx: ToolContext): Promise<Restriction[]> {
  return step(ctx, 'getFoodRestrictions', {}, async () => {
    const rows = await prisma.foodRestriction.findMany({
      where: { userId: ctx.userId },
      include: { member: true },
    })
    const restrictions: Restriction[] = rows.map((r) => ({
      restrictionType: r.restrictionType as Restriction['restrictionType'],
      value: r.value,
      severity: r.severity as Restriction['severity'],
      memberName: r.member?.name,
    }))
    const allergies = restrictions.filter((r) => r.restrictionType === 'allergy')
    return {
      result: restrictions,
      summary:
        restrictions.length === 0
          ? 'Харчових обмежень не задано'
          : `Обмежень: ${restrictions.length}${allergies.length ? `, з них алергій: ${allergies.length}` : ''}`,
      output: restrictions.map((r) => ({ type: r.restrictionType, value: r.value, severity: r.severity })),
    }
  })
}

// ─────────────────────────── 2. Комора ───────────────────────────

export async function getPantryInventory(ctx: ToolContext): Promise<PantryEntry[]> {
  return step(ctx, 'getPantryInventory', {}, async () => {
    const items = await loadPantry(ctx.userId)
    return {
      result: items,
      summary: `У коморі ${items.length} позицій`,
      output: { count: items.length, categories: [...new Set(items.map((i) => i.category))] },
    }
  })
}

export async function loadPantry(userId: string): Promise<PantryEntry[]> {
  const rows = await prisma.pantryItem.findMany({
    where: { userId, consumedAt: null, quantity: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toPantryEntry)
}

function toPantryEntry(row: {
  id: string
  normalizedName: string
  originalName: string
  category: string
  quantity: number
  unit: string
  expiryDate: Date | null
  storageLocation: string
  source: string
  confidence: number
  needsConfirmation: boolean
}): PantryEntry {
  return {
    id: row.id,
    normalizedName: row.normalizedName,
    originalName: row.originalName,
    category: row.category,
    quantity: row.quantity,
    unit: row.unit as Unit,
    expiryDate: row.expiryDate,
    storageLocation: row.storageLocation as StorageLocation,
    source: row.source as PantrySource,
    confidence: row.confidence,
    needsConfirmation: row.needsConfirmation,
  }
}

export async function findExpiringProductsTool(ctx: ToolContext, limit = 5): Promise<PantryEntry[]> {
  return step(ctx, 'findExpiringProducts', { limit }, async () => {
    const items = await loadPantry(ctx.userId)
    const expiring = findExpiringProducts(items, ctx.now, limit)
    return {
      result: expiring,
      summary:
        expiring.length === 0
          ? 'Продуктів із близьким терміном придатності немає'
          : `Потребують уваги: ${expiring.map((e) => displayName(e.originalName)).join(', ')}`,
      output: expiring.map((e) => ({ name: e.originalName, status: expiryStatus(e.expiryDate, ctx.now) })),
    }
  })
}

export const AnalyzePhotosInput = z.object({
  photos: z.array(z.object({ base64: z.string(), mime: z.string(), hint: z.string().optional() })).min(1).max(5),
})

export async function analyzePantryPhotosTool(ctx: ToolContext, photos: PhotoInput[]) {
  return step(ctx, 'analyzePantryPhotos', { photoCount: photos.length }, async () => {
    const outcome = await analyzePantryPhotos(photos)
    const enriched = outcome.items.map((item) => enrichRecognizedItem(item, ctx.now))
    return {
      result: { ...outcome, enriched },
      summary: `Розпізнано ${enriched.length} позицій (${outcome.engine === 'claude' ? 'Claude vision' : 'demo-аналізатор'}). Усі потребують підтвердження.`,
      output: enriched.map((e) => ({ name: e.originalName, quantity: e.quantity, unit: e.unit, confidence: e.confidence })),
    }
  })
}

export const UpdatePantryInput = z.object({
  confirmationToken: z.string().min(8),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        originalName: z.string().min(1),
        category: z.string().default('Інше'),
        quantity: z.number().positive(),
        unit: z.enum(['г', 'кг', 'мл', 'л', 'шт']),
        expiryDate: z.string().nullable().optional(),
        storageLocation: z.string().default('other'),
        source: z.enum(['photo', 'manual', 'online_order', 'offline_receipt', 'previous_cart']),
        confidence: z.number().min(0).max(1).default(1),
      }),
    )
    .max(60),
  /** id позицій, які користувач видалив на екрані підтвердження */
  removeIds: z.array(z.string()).default([]),
})

/**
 * WRITE. Записує підтверджені користувачем позиції в комору.
 * Токен підтвердження перевіряється рівнем вище (route handler),
 * тут ми лише не даємо викликати інструмент без нього.
 */
export async function updatePantryInventory(
  ctx: ToolContext,
  input: z.infer<typeof UpdatePantryInput>,
): Promise<{ created: number; updated: number; removed: number }> {
  if (!input.confirmationToken) throw new ConfirmationRequiredError()
  return step(ctx, 'updatePantryInventory', { count: input.items.length, removed: input.removeIds.length }, async () => {
    let created = 0
    let updated = 0

    for (const item of input.items) {
      const normalizedName = normalizeProductName(item.originalName)
      const data = {
        userId: ctx.userId,
        normalizedName,
        originalName: item.originalName,
        category: item.category,
        quantity: item.quantity,
        unit: item.unit,
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
        storageLocation: item.storageLocation,
        source: item.source,
        confidence: item.confidence,
        // користувач щойно підтвердив — прапорець знімаємо
        needsConfirmation: false,
      }
      if (item.id) {
        await prisma.pantryItem.update({ where: { id: item.id }, data })
        updated += 1
      } else {
        await prisma.pantryItem.create({ data })
        created += 1
      }
    }

    let removed = 0
    if (input.removeIds.length > 0) {
      const res = await prisma.pantryItem.deleteMany({
        where: { id: { in: input.removeIds }, userId: ctx.userId },
      })
      removed = res.count
    }

    return {
      result: { created, updated, removed },
      summary: `Комору оновлено: додано ${created}, змінено ${updated}, видалено ${removed}`,
      output: { created, updated, removed },
    }
  })
}

/** Наповнення комори з історії покупок — ключовий сценарій продукту. */
export async function importPantryFromReceipts(ctx: ToolContext): Promise<{ imported: number; skipped: number }> {
  return step(ctx, 'importPantryFromReceipts', {}, async () => {
    const orders = await ctx.adapter.getOrders()
    const { items, decisions } = inferPantryFromReceipts(
      orders.map((o) => ({ orderId: o.orderId, date: o.date, kind: o.kind, items: o.items })),
      ctx.now,
    )

    const existing = await prisma.pantryItem.findMany({
      where: { userId: ctx.userId, consumedAt: null },
      select: { normalizedName: true },
    })
    const known = new Set(existing.map((e) => e.normalizedName))

    let imported = 0
    for (const item of items) {
      if (known.has(item.normalizedName)) continue
      await prisma.pantryItem.create({
        data: {
          userId: ctx.userId,
          normalizedName: item.normalizedName,
          originalName: item.originalName,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          expiryDate: item.expiryDate,
          storageLocation: item.storageLocation,
          source: item.source,
          confidence: item.confidence,
          needsConfirmation: true,
          productId: item.productId,
        },
      })
      imported += 1
    }

    for (const order of orders) {
      await prisma.receiptImport
        .create({
          data: {
            userId: ctx.userId,
            kind: order.kind,
            orderRef: order.orderId,
            orderDate: new Date(order.date),
            importedCount: imported,
            detail: JSON.stringify(decisions.slice(0, 40)),
          },
        })
        .catch(() => undefined) // унікальний orderRef: повторний імпорт того самого чека ігноруємо
    }

    const skipped = decisions.filter((d) => d.decision !== 'imported').length
    return {
      result: { imported, skipped },
      summary: `З ${orders.length} чеків додано ${imported} позицій, пропущено ${skipped} (протерміноване, непродовольче або вже спожите)`,
      output: { imported, skipped, sample: decisions.slice(0, 6) },
    }
  })
}

// ─────────────────────────── 3. Рецепти ───────────────────────────

export const RecipeOptionsInput = z.object({
  servings: z.number().int().min(1).max(12).optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'dessert', 'snack']).optional(),
  maxMinutes: z.number().int().min(5).max(240).optional(),
  maxBudget: z.number().int().min(0).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  cuisine: z.string().optional(),
  rescueMode: z.boolean().optional(),
  limit: z.number().int().min(1).max(8).optional(),
})

export async function generateRecipeOptions(
  ctx: ToolContext,
  input: z.infer<typeof RecipeOptionsInput>,
  household: HouseholdContext,
  pantry: PantryEntry[],
) {
  return step(ctx, 'generateRecipeOptions', input, async () => {
    let pool: RecipeLike[] = SEED_RECIPES
    if (input.mealType) pool = pool.filter((r) => r.mealType === input.mealType)
    if (input.difficulty) pool = pool.filter((r) => r.difficulty === input.difficulty)
    if (input.cuisine) pool = pool.filter((r) => r.cuisine.toLowerCase().includes(input.cuisine!.toLowerCase()))
    if (pool.length === 0) pool = SEED_RECIPES

    const ranked = rankRecipes(
      pool,
      {
        pantry,
        household,
        servings: input.servings,
        maxMinutes: input.maxMinutes,
        maxBudget: input.maxBudget ?? household.weeklyBudget,
        rescueMode: input.rescueMode,
        now: ctx.now,
      },
      input.limit ?? 5,
    )

    return {
      result: ranked,
      summary: `Підібрано ${ranked.length} страв. Найкраща: «${ranked[0]?.recipe.title ?? '—'}»`,
      output: ranked.map((r) => ({
        title: r.recipe.title,
        score: r.score,
        coverage: Math.round(r.coverage.coverage * 100),
        missing: r.coverage.missing.length,
      })),
    }
  })
}

export async function calculateMissingIngredientsTool(
  ctx: ToolContext,
  recipe: RecipeLike,
  pantry: PantryEntry[],
  servings?: number,
) {
  return step(ctx, 'calculateMissingIngredients', { recipe: recipe.title, servings }, async () => {
    const coverage = calculateMissingIngredients(recipe, pantry, { servings, now: ctx.now })
    return {
      result: coverage,
      summary:
        coverage.missing.length === 0
          ? 'Усі інгредієнти вже є вдома'
          : `Не вистачає ${coverage.missing.length}: ${coverage.missing.map((m) => m.name).join(', ')} (≈ ${formatUah(coverage.approxMissingCost)})`,
      output: coverage.missing.map((m) => ({ name: m.name, missing: m.missing, unit: m.unit, kind: m.kind })),
    }
  })
}

/**
 * Планування раціону на кілька днів уперед.
 *
 * Відрізняється від generateRecipeOptions тим, що симулює споживання:
 * комора вичерпується від страви до страви, тож список покупок на тиждень
 * рахується чесно, без подвійного зарахування тих самих продуктів.
 */
export async function generateWeeklyPlan(
  ctx: ToolContext,
  input: { days?: number; mealsPerDay?: number; budget?: number | null },
  household: HouseholdContext,
  pantry: PantryEntry[],
) {
  return step(ctx, 'generateWeeklyPlan', input, async () => {
    const plan = buildWeeklyPlan({
      recipes: SEED_RECIPES,
      pantry,
      household,
      days: input.days,
      mealsPerDay: input.mealsPerDay,
      budget: input.budget,
      now: ctx.now,
    })
    return {
      result: plan,
      summary: `${describePlan(plan)}${plan.budget.withinBudget ? '' : ' · бюджет перевищено'}`,
      output: {
        days: plan.days.length,
        meals: countMeals(plan),
        shoppingList: plan.shoppingList.length,
        totalCost: plan.totalMissingCost,
        rescued: plan.rescuedProducts.length,
        atRisk: plan.atRiskProducts.length,
      },
    }
  })
}

/** WRITE. Зберігає затверджений план у календар харчування. */
export async function saveMealPlan(
  ctx: ToolContext,
  params: { plan: WeeklyPlan; confirmationToken: string },
) {
  if (!params.confirmationToken) throw new ConfirmationRequiredError()
  return step(ctx, 'saveMealPlan', { days: params.plan.days.length }, async () => {
    // план перезаписується цілком: тримати два конкуруючих розклади безглуздо
    const from = params.plan.days[0]?.date ?? ctx.now
    const to = params.plan.days[params.plan.days.length - 1]?.date ?? ctx.now
    await prisma.mealPlan.deleteMany({
      where: { userId: ctx.userId, date: { gte: startOfDay(from), lte: endOfDay(to) } },
    })

    let saved = 0
    for (const day of params.plan.days) {
      for (const meal of day.meals) {
        await prisma.mealPlan.create({
          data: {
            userId: ctx.userId,
            date: startOfDay(day.date),
            mealType: meal.mealType,
            recipeId: meal.recipe.id,
            servings: meal.servings,
            status: 'planned',
          },
        })
        saved += 1
      }
    }
    return {
      result: { saved },
      summary: `Збережено ${saved} страв у календарі харчування`,
      output: { saved },
    }
  })
}

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

// ─────────────────────────── 4. Каталог «Сільпо» ───────────────────────────

export async function searchSilpoProducts(
  ctx: ToolContext,
  missing: { name: string; normalizedName: string; missing: number; unit: Unit }[],
) {
  return step(ctx, 'searchSilpoProducts', { queries: missing.map((m) => m.name) }, async () => {
    const raw = await ctx.adapter.findProducts(
      missing.map((m) => ({ ingredientKey: m.normalizedName, query: m.name, limit: 8 })),
    )

    /**
     * Каталог шукає за входженням слова, тому на «Яйця» приходить шоколадне
     * яйце з сюрпризом, а на «Какао» — какао-плитка. Для готових страв
     * перевірка правдоподібності була від початку, для інгредієнтів — ні,
     * і в кошик потрапляли солодощі замість продуктів.
     */
    const results = raw.map((r, i) => {
      const ingredient = missing[i]?.name ?? r.ingredientKey
      const kept = r.products.filter((p) => isPlausibleIngredientMatch(p.name, ingredient))
      /**
       * Якщо не лишилось нічого — повертаємо як було. Мовчки втратити
       * інгредієнт гірше, ніж показати сумнівний варіант: людина бачить
       * назву товару й може обрати інший, а зниклий рядок помітити нічим.
       */
      return { ...r, products: kept.length > 0 ? kept : r.products }
    })

    const found = results.reduce((s, r) => s + r.products.length, 0)
    const dropped = raw.reduce((s, r) => s + r.products.length, 0) - found
    return {
      result: results,
      summary: `Знайдено ${found} товарів для ${missing.length} позицій (${ctx.adapter.mode === 'live' ? 'MCP live' : 'demo'})${dropped > 0 ? `, відсіяно нерелевантних: ${dropped}` : ''}`,
      output: results.map((r) => ({ ingredient: r.ingredientKey, found: r.products.length })),
    }
  })
}

export async function compareProductOptions(
  ctx: ToolContext,
  missing: { name: string; normalizedName: string; missing: number; unit: Unit; approxCost: number; optional: boolean }[],
  searchResults: { ingredientKey: string; products: ProductOption[] }[],
  restrictions: Restriction[],
) {
  return step(ctx, 'compareProductOptions', {}, async () => {
    const comparisons = missing.map((m) => {
      const products = searchResults.find((r) => r.ingredientKey === m.normalizedName)?.products ?? []
      const tiers = buildTiers(products, {
        name: m.name,
        normalizedName: m.normalizedName,
        needed: m.missing,
        have: 0,
        missing: m.missing,
        unit: m.unit,
        kind: 'absent',
        optional: m.optional,
        approxCost: m.approxCost,
      })
      const safety = tiers.map((t) => ({
        productId: t.product.productId,
        ...checkProductAgainstRestrictions(t.product, restrictions),
      }))
      return { ingredient: m, tiers, safety }
    })

    const warned = comparisons.filter((c) => c.safety.some((s) => !s.safe)).length
    return {
      result: comparisons,
      summary: `Сформовано варіанти для ${comparisons.length} позицій${warned ? `, попереджень про алергени: ${warned}` : ''}`,
      output: comparisons.map((c) => ({
        ingredient: c.ingredient.name,
        tiers: c.tiers.map((t) => ({ tier: t.tier, name: t.product.name, total: t.lineTotal })),
      })),
    }
  })
}

export async function compareCookVsReadyMeal(
  ctx: ToolContext,
  params: {
    recipe: RecipeLike
    missingCost: number
    missingCostConsumed?: number
    pantryValue: number
    desiredServings: number
    readyKey: string
  },
) {
  return step(ctx, 'compareCookVsReadyMeal', { recipe: params.recipe.title }, async () => {
    let readyProducts: ProductOption[] = []
    if (ctx.adapter instanceof MockSilpoAdapter) {
      readyProducts = await ctx.adapter.findReadyMeals(params.readyKey)
    } else {
      // Каталог «Сільпо» шукає за точною фразою: «тірамісу» дає 5 товарів,
      // а «тірамісу готовий десерт кулінарія» — жодного. Тому запит — лише назва.
      const res = await ctx.adapter.findProducts([
        { ingredientKey: params.readyKey, query: params.recipe.title, limit: 8 },
      ])
      readyProducts = res[0]?.products.filter((p) => isPlausibleReadyMeal(p.name, params.recipe.title)) ?? []
    }

    // Обираємо найдешевший ЗА ПОРЦІЮ, а не за упаковку: торт на 6 порцій
    // за 279 грн вигідніший за тістечко за 174 грн, хоч і дорожчий на ціннику.
    const ranked = readyProducts
      .map((p) => {
        const servings = estimateServingsPerPack(p.name, p.packSize, p.unit)
        return { p, servings, perServing: (p.promoPrice ?? p.price) / servings }
      })
      .sort((a, b) => a.perServing - b.perServing)

    const best = ranked[0]?.p ?? null
    const servingsPerPack = ranked[0]?.servings ?? 1
    const comparison = compareCookVsReady({
      missingCost: params.missingCost,
      missingCostConsumed: params.missingCostConsumed,
      pantryValue: params.pantryValue,
      cookMinutes: params.recipe.cookingTime,
      cookServings: params.desiredServings,
      readyProduct: best,
      readyServingsPerPack: servingsPerPack,
      desiredServings: params.desiredServings,
      readyMinutes: 0,
    })

    return {
      result: { comparison, alternatives: readyProducts },
      summary: comparison.explanation,
      output: {
        recommendation: comparison.recommendation,
        cookTotal: comparison.cook.totalCost,
        readyTotal: comparison.ready?.totalCost ?? null,
      },
    }
  })
}

/**
 * Чи справді це готовий аналог страви, а не товар «зі смаком».
 * Пошук за словом «тірамісу» повертає і торт, і шоколад «смак тірамісу»,
 * і морозиво — порівнювати ціну порції з шоколадкою було б безглуздо.
 */
/**
 * Форми, які означають ІНШИЙ продукт, а не інгредієнт.
 *
 * Слово відсіює товар лише тоді, коли самого інгредієнта воно не стосується:
 * для «шоколад» товар із «шоколадний» цілком доречний, для «яйця» — ні.
 */
const NOT_AN_INGREDIENT = [
  'шоколад',
  'цукерк',
  'батончик',
  'драже',
  'морозиво',
  'лікер',
  'напій',
  'плитка',
  'сироп',
]

/**
 * Чи схожий товар на сам інгредієнт, а не на солодощі з його назвою.
 *
 * Живий приклад із прогону «тірамісу»: на «Яйця» каталог повернув
 * «Яйце шоколадне The Smurfs із сюрпризом», на «Какао» — «Какао-плитка»,
 * на «Маскарпоне» — «Десерт Bonjour зі смаком чорниці та маскарпоне».
 */
export function isPlausibleIngredientMatch(productName: string, ingredientName: string): boolean {
  const name = productName.toLowerCase()
  const ingredient = ingredientName.toLowerCase()
  // «зі смаком X» — ароматизований продукт, а не сам X
  if (name.includes('смак') && !ingredient.includes('смак')) return false
  return !NOT_AN_INGREDIENT.some((w) => name.includes(w) && !ingredient.includes(w))
}

export function isPlausibleReadyMeal(productName: string, dishTitle: string): boolean {
  const name = productName.toLowerCase()
  const dish = dishTitle.toLowerCase()
  if (!name.includes(dish.split(' ')[0])) return false
  // «зі смаком X» — це ароматизований продукт, а не сама страва
  if (name.includes('смак')) return false
  const NOT_A_DISH = ['шоколад', 'морозиво', 'напій', 'сироп', 'кава', 'йогурт', 'печиво', 'батончик', 'цукерк']
  return !NOT_A_DISH.some((w) => name.includes(w))
}

// ─────────────────────────── 5. Пропозиція та кошик ───────────────────────────

export interface ProposalLine {
  ingredientName: string
  normalizedName: string
  productId: string
  /** обовʼязкові для live-запису в кошик «Сільпо» */
  companyId?: string
  branchId?: string
  productName: string
  tier: string
  /** кількість КРОКІВ ваги або упаковок; у кошик їде через `cartQuantity` */
  quantity: number
  /** ваговий товар: «Сільпо» чекає кілограми, а не лічильник кроків */
  weighted?: boolean
  /** розмір кроку/упаковки — потрібен, щоб перерахувати кількість для кошика */
  packSize?: number
  packUnit?: Unit
  price: number
  promoPrice?: number
  lineTotal: number
  promoSaving: number
  warnings: string[]
}

export async function createShoppingProposal(
  ctx: ToolContext,
  params: {
    goal: string
    recipeId?: string
    lines: ProposalLine[]
    /** усі показані варіанти — джерело правди при підтвердженні */
    options?: ProposalLine[]
    missing: unknown
  },
): Promise<{ proposalId: string; confirmationToken: string; total: number }> {
  return step(ctx, 'createShoppingProposal', { goal: params.goal, lines: params.lines.length }, async () => {
    const totals = sumBasket(params.lines)
    const confirmationToken = randomBytes(24).toString('base64url')

    // Кожне відкриття екрана страви створювало нову чернетку, і на екрані
    // кошика накопичувались однакові пропозиції. Попередні чернетки з тією
    // самою метою скасовуємо — актуальною лишається одна.
    const superseded = await prisma.shoppingProposal.updateMany({
      where: { userId: ctx.userId, goal: params.goal, status: 'draft' },
      data: { status: 'cancelled' },
    })
    const proposal = await prisma.shoppingProposal.create({
      data: {
        userId: ctx.userId,
        recipeId: params.recipeId,
        goal: params.goal,
        missingIngredients: JSON.stringify(params.missing),
        selectedProducts: JSON.stringify(params.lines),
        productOptions: JSON.stringify(params.options ?? params.lines),
        totalPrice: totals.total,
        status: 'draft',
        confirmationToken,
      },
    })
    return {
      result: { proposalId: proposal.id, confirmationToken, total: totals.total },
      summary: `Пропозиція на ${params.lines.length} товарів, ${formatUah(totals.total)}. Кошик НЕ змінено — чекаємо підтвердження.${superseded.count > 0 ? ` Замінено попередніх чернеток: ${superseded.count}.` : ''}`,
      output: { lines: params.lines.length, total: totals.total, status: 'draft' },
    }
  })
}

/**
 * WRITE у кошик «Сільпо». Єдиний шлях змінити кошик.
 * Без валідного одноразового токена підтвердження не виконується.
 */
export async function addConfirmedItemsToCart(
  ctx: ToolContext,
  params: { proposalId: string; confirmationToken: string },
) {
  return step(ctx, 'addConfirmedItemsToCart', { proposalId: params.proposalId }, async () => {
    const proposal = await prisma.shoppingProposal.findFirst({
      where: { id: params.proposalId, userId: ctx.userId },
    })
    if (!proposal) throw new Error('Пропозицію не знайдено')
    if (proposal.confirmationToken !== params.confirmationToken) {
      throw new ConfirmationRequiredError('Невалідний токен підтвердження — кошик не змінено')
    }
    if (proposal.status === 'added_to_cart') {
      throw new ConfirmationRequiredError('Цю пропозицію вже додано до кошика')
    }

    const lines = JSON.parse(proposal.selectedProducts) as ProposalLine[]

    /**
     * Пропозиції, збережені до появи полів ваги, не містять `packUnit`.
     * Для вагового товару це означає, що ми не знаємо його крок — і надіслали б
     * лічильник кроків там, де «Сільпо» чекає кілограми (2 замість 0,4 кг).
     *
     * Здогадуватись тут не можна: помилка коштує грошей і виявиться вже після
     * оформлення. Просимо переформувати пропозицію — це один дотик на екрані.
     */
    const stale = lines.filter((l) => l.packUnit === undefined)
    if (stale.length > 0) {
      throw new ConfirmationRequiredError(
        'Ця пропозиція створена до оновлення застосунку. Відкрийте страву заново — кошик не змінено.',
      )
    }

    const cart = await ctx.adapter.addToCart(
      lines.map((l) => ({
        productId: l.productId,
        /**
         * Для вагових товарів «Сільпо» чекає кілограми, кратні кроку ваги, а
         * не лічильник кроків. Перерахунок саме тут, на межі із зовнішньою
         * системою: усередині застосунку `quantity` скрізь означає кроки.
         */
        quantity: cartQuantity(
          {
            productId: l.productId,
            name: l.productName,
            price: l.price,
            unit: l.packUnit!,
            packSize: l.packSize ?? 1,
            weighted: l.weighted,
          },
          l.quantity,
        ),
        companyId: l.companyId,
        branchId: l.branchId,
      })),
    )
    await prisma.shoppingProposal.update({
      where: { id: proposal.id },
      data: { status: 'added_to_cart' },
    })

    return {
      result: cart,
      summary: `Додано ${lines.length} товарів. У кошику ${cart.lines.length} позицій на ${formatUah(cart.total)}`,
      output: { lines: cart.lines.length, total: cart.total, checkout: !!cart.checkoutUrl },
    }
  })
}

export async function getCartSummary(ctx: ToolContext) {
  return step(ctx, 'getCartSummary', {}, async () => {
    const [cart, loyalty, coupons, slots] = await Promise.all([
      ctx.adapter.getCart(),
      ctx.adapter.getLoyalty().catch(() => ({ balabonuses: 0 })),
      ctx.adapter.getCoupons().catch(() => []),
      ctx.adapter.getTimeSlots().catch(() => []),
    ])
    return {
      result: { cart, loyalty, coupons, slots },
      summary: `Кошик: ${cart.lines.length} позицій, ${formatUah(cart.total)}, економія ${formatUah(cart.discount)}`,
      output: { lines: cart.lines.length, total: cart.total, validations: cart.validations },
    }
  })
}

// ─────────────────────────── 6. Приготування ───────────────────────────

export async function recordCookedMeal(
  ctx: ToolContext,
  params: { recipe: RecipeLike; servings: number; confirmationToken: string; apply: boolean },
) {
  if (!params.confirmationToken) throw new ConfirmationRequiredError()
  return step(ctx, 'recordCookedMeal', { recipe: params.recipe.title, servings: params.servings, apply: params.apply }, async () => {
    const pantry = await loadPantry(ctx.userId)
    const multiplier = params.servings / params.recipe.servings
    const { plan, shortfall } = planDeduction(pantry, params.recipe.ingredients, multiplier, ctx.now)

    if (params.apply) {
      for (const line of plan) {
        if (line.removed) {
          await prisma.pantryItem.update({
            where: { id: line.itemId },
            data: { quantity: 0, consumedAt: ctx.now },
          })
        } else {
          await prisma.pantryItem.update({ where: { id: line.itemId }, data: { quantity: line.remaining } })
        }
      }
    }

    return {
      result: { plan, shortfall, applied: params.apply },
      summary: params.apply
        ? `Списано ${plan.length} позицій з комори${shortfall.length ? `, не вистачило: ${shortfall.map((s) => s.normalizedName).join(', ')}` : ''}`
        : `Попередній розрахунок списання: ${plan.length} позицій`,
      output: plan.map((p) => ({ name: p.originalName, deducted: p.deducted, unit: p.unit, removed: p.removed })),
    }
  })
}

// ─────────────────────────── допоміжне ───────────────────────────

export async function getDashboardStats(ctx: ToolContext, household: HouseholdContext, pantry: PantryEntry[]) {
  const days = estimateDaysOfFood(pantry, household.members.length, household.mealsPerDay)
  return { daysOfFood: days }
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
