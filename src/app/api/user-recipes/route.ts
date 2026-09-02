import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import {
  UserRecipeInputSchema,
  checkComposition,
  slugifyTitle,
  isoWeek,
  pickWeeklyWinner,
  weekLabel,
} from '@/lib/domain/user-recipes'
import { moderateRecipe } from '@/lib/domain/moderation'
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

    /**
     * Автоперевірка ПЕРЕД публікацією. Те, що не пройшло, лишається
     * чернеткою: видно лише авторові, разом із причиною. Це не «на розгляді
     * в модератора» — людини-модератора в прототипі немає, і вдавати чергу,
     * якої ніхто не розбирає, було б гірше за миттєву публікацію.
     */
    const verdict = moderateRecipe({
      title: input.title,
      summary: input.summary,
      steps: input.steps,
      tips: input.tips,
      ingredients: composition.ingredients,
      declaredAllergens: input.declaredAllergens,
      unknownIngredients: composition.unknown,
    })

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
        moderationIssues: JSON.stringify(verdict.issues),
        status: verdict.status,
      },
    })

    logEvent('info', 'user_recipe.created', {
      verified: composition.verified,
      unknownCount: composition.unknown.length,
      status: verdict.status,
      blocked: verdict.issues.filter((i) => i.severity === 'block').map((i) => i.code),
    })

    const blocking = verdict.issues.filter((i) => i.severity === 'block')
    return {
      id: recipe.id,
      slug: recipe.slug,
      status: verdict.status,
      issues: verdict.issues,
      compositionVerified: composition.verified,
      unknownIngredients: composition.unknown,
      /**
       * Одне речення, яке автор прочитає замість вердикту: що сталося
       * з рецептом і що робити далі.
       */
      note:
        blocking.length > 0
          ? `Рецепт збережено як чернетку — його поки не видно у стрічці. ${blocking.map((i) => i.message).join(' ')}`
          : composition.verified
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

    /**
     * Стрічка показує опубліковане — плюс власні чернетки й приховане
     * авторові. Інакше рецепт, який не пройшов автоперевірку, зникав би
     * безслідно: людина натиснула «Опублікувати», нічого не побачила й не
     * знає, що саме виправляти.
     */
    const recipes = await prisma.userRecipe.findMany({
      where: { OR: [{ status: 'published' }, { authorId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { votes: true, reports: true } } },
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
      /**
       * Підпис тижня рендериться СЕРВЕРОМ. Клієнт порівнював серверний ключ
       * зі своїм годинником: сервер на UTC + клієнт у Києві вночі понеділка
       * бачив «11.08–17.08» замість «цього тижня», хоча голоси писались у
       * серверний тиждень. Один годинник — одна правда.
       */
      weekLabelText: weekLabel(week, now),
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
        weekLabelText: weekLabel(a.isoWeek, now),
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
        status: r.status,
        // причини й лічильник скарг — тільки авторові: чуже «на нього поскаржились
        // двічі» перетворило б стрічку на табло репутації
        moderationIssues: r.authorId === userId ? safeIssues(r.moderationIssues) : [],
        reports: r.authorId === userId ? r._count.reports : undefined,
        votesTotal: r._count.votes,
        votesThisWeek: votesThisWeek.get(r.id) ?? 0,
        votedByMe: mine.has(r.id),
        createdAt: r.createdAt.toISOString(),
      })),
    }
  })
}

interface StoredIssue {
  code: string
  severity: string
  message: string
}

function safeIssues(raw: string): StoredIssue[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredIssue[]) : []
  } catch {
    return []
  }
}

function safeArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
