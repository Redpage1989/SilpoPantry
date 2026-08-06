import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import {
  UserRecipeInputSchema,
  checkComposition,
  slugifyTitle,
  isoWeek,
  pickWeeklyWinner,
} from '@/lib/domain/user-recipes'
import { logEvent } from '@/lib/mcp/pii'
import { closeFinishedWeeks } from '@/lib/awards'
import { prizeBalabonuses, AWARD_STATUS_LABELS, type AwardStatus } from '@/lib/domain/weekly-award'

/** Публікація рецепта користувачем. */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 5 }, async (userId) => {
    const input = UserRecipeInputSchema.parse(await request.json())
    const composition = checkComposition(input.ingredients)

    // slug має бути унікальним; додаємо суфікс, якщо назва вже зайнята
    let slug = slugifyTitle(input.title)
    if (await prisma.userRecipe.findUnique({ where: { slug } })) {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`
    }

    const recipe = await prisma.userRecipe.create({
      data: {
        authorId: userId,
        slug,
        title: input.title,
        summary: input.summary,
        servings: input.servings,
        cookingTime: input.cookingTime,
        difficulty: input.difficulty,
        cuisine: input.cuisine,
        mealType: input.mealType,
        imageEmoji: input.imageEmoji,
        ingredients: JSON.stringify(composition.ingredients),
        steps: JSON.stringify(input.steps.map((s, i) => ({ step: i + 1, ...s }))),
        tips: JSON.stringify(input.tips),
        declaredAllergens: JSON.stringify(input.declaredAllergens),
        compositionVerified: composition.verified,
        unknownIngredients: JSON.stringify(composition.unknown),
        status: 'published',
      },
    })

    logEvent('info', 'user_recipe.created', {
      verified: composition.verified,
      unknownCount: composition.unknown.length,
    })

    return {
      id: recipe.id,
      slug: recipe.slug,
      compositionVerified: composition.verified,
      unknownIngredients: composition.unknown,
      /**
       * Чесно кажемо авторові, що саме означає «неперевірений»:
       * рецепт видно всім, але агент не покладе його в раціон, бо не може
       * зіставити склад із коморою й обмеженнями родини.
       */
      note: composition.verified
        ? 'Склад розпізнано повністю — агент зможе враховувати цей рецепт у підборі страв.'
        : `Не вдалося розпізнати: ${composition.unknown.join(', ')}. Рецепт опубліковано, але агент не братиме його в раціон, бо не може звірити склад із вашою коморою й алергіями.`,
    }
  })
}

/** Стрічка рецептів спільноти + рецепт тижня. */
export async function GET(request: Request) {
  return handle(request, {}, async (userId) => {
    const now = new Date()
    const week = isoWeek(now)

    // тижні, що вже завершились, отримують зафіксованого переможця й заявку на приз
    await closeFinishedWeeks(now)

    const recipes = await prisma.userRecipe.findMany({
      where: { status: 'published' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { votes: true } } },
    })

    const weekVotes = await prisma.recipeVote.groupBy({
      by: ['userRecipeId'],
      where: { isoWeek: week },
      _count: { userRecipeId: true },
    })
    const votesThisWeek = new Map(weekVotes.map((v) => [v.userRecipeId, v._count.userRecipeId]))

    const myVotes = await prisma.recipeVote.findMany({
      where: { voterId: userId, isoWeek: week },
      select: { userRecipeId: true },
    })
    const mine = new Set(myVotes.map((v) => v.userRecipeId))

    const winner = pickWeeklyWinner(
      weekVotes.map((v) => ({ recipeId: v.userRecipeId, votes: v._count.userRecipeId })),
      week,
    )

    const awards = await prisma.weeklyAward.findMany({
      orderBy: { isoWeek: 'desc' },
      take: 8,
      include: {
        recipe: { select: { title: true, slug: true, imageEmoji: true } },
        author: { select: { displayName: true } },
      },
    })

    return {
      isoWeek: week,
      winner,
      /**
       * Приз показуємо як пропозицію застосунку, а не як обіцянку «Сільпо»:
       * нарахувати балабонуси зсередини неможливо — усі лояльнісні
       * інструменти MCP працюють лише на читання.
       */
      prize: {
        balabonuses: prizeBalabonuses(),
        awardedBy: 'Сільпо',
        confirmed: false,
      },
      awards: awards.map((a) => ({
        isoWeek: a.isoWeek,
        title: a.recipe.title,
        slug: a.recipe.slug,
        imageEmoji: a.recipe.imageEmoji,
        author: a.author.displayName,
        isMine: a.authorId === userId,
        votes: a.votes,
        prizeBalabonuses: a.prizeBalabonuses,
        status: a.status,
        statusLabel: AWARD_STATUS_LABELS[a.status as AwardStatus] ?? a.status,
      })),
      recipes: recipes.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        servings: r.servings,
        cookingTime: r.cookingTime,
        difficulty: r.difficulty,
        cuisine: r.cuisine,
        mealType: r.mealType,
        imageEmoji: r.imageEmoji,
        compositionVerified: r.compositionVerified,
        declaredAllergens: safeArray(r.declaredAllergens),
        unknownIngredients: safeArray(r.unknownIngredients),
        isMine: r.authorId === userId,
        votesTotal: r._count.votes,
        votesThisWeek: votesThisWeek.get(r.id) ?? 0,
        votedByMe: mine.has(r.id),
        createdAt: r.createdAt.toISOString(),
      })),
    }
  })
}

function safeArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
