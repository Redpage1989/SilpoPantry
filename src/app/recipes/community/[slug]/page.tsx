import { notFound, redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { loadPantry } from '@/lib/agent/tools'
import { prisma } from '@/lib/db'
import { calculateMissingIngredients } from '@/lib/domain/matching'
import { checkRecipeAgainstRestrictions } from '@/lib/domain/restrictions'
import { toRecipeLike } from '@/lib/domain/user-recipes'
import { Card } from '@/components/ui'
import { RecipeDetail } from '../../RecipeDetail'
import { RecipeActions } from '../../[slug]/RecipeActions'
import type { Restriction } from '@/lib/domain/types'

export const dynamic = 'force-dynamic'

/**
 * Рецепт спільноти на повний екран.
 *
 * Окремий маршрут, а не запасний варіант усередині `/recipes/[slug]`: slug
 * рецепта спільноти будується з назви й перевіряється на унікальність лише
 * серед рецептів спільноти. «Сирники» від людини дали б slug `syrnyky`, який
 * уже зайнятий книгою, і рецепт назавжди лишився б недосяжним.
 *
 * Усе інше — покриття коморою, перевірка алергій, списання після готування —
 * той самий код, що й для книги (див. RecipeDetail).
 */
export default async function CommunityRecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ servings?: string }>
}) {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  const { slug } = await params
  const { servings: servingsParam } = await searchParams

  /**
   * Чернетку показуємо авторові: рецепт, який не пройшов автоперевірку,
   * інакше зникав би безслідно — так само, як у стрічці.
   */
  const row = await prisma.userRecipe.findFirst({
    where: { slug, OR: [{ status: 'published' }, { authorId: userId }] },
    include: { author: { select: { displayName: true } } },
  })
  if (!row) notFound()

  const recipe = toRecipeLike(row)
  const servings = Math.max(1, Math.min(12, Number(servingsParam) || recipe.servings))

  const [pantry, restrictionRows] = await Promise.all([
    loadPantry(userId),
    prisma.foodRestriction.findMany({ where: { userId }, include: { member: true } }),
  ])

  const restrictions: Restriction[] = restrictionRows.map((r) => ({
    restrictionType: r.restrictionType as Restriction['restrictionType'],
    value: r.value,
    severity: r.severity as Restriction['severity'],
    memberName: r.member?.name,
  }))

  const coverage = calculateMissingIngredients(recipe, pantry, { servings })
  const check = checkRecipeAgainstRestrictions(recipe, restrictions)
  const unknown = safeArray(row.unknownIngredients)

  return (
    <RecipeDetail
      recipe={recipe}
      coverage={coverage}
      check={check}
      servings={servings}
      backHref="/recipes/community"
      backLabel="До рецептів спільноти"
      notice={
        <>
          <Card className="mb-3 bg-cream-50">
            <p className="text-[12px] text-graphite-500">
              Рецепт від {row.author.displayName}
              {row.status !== 'published' && ' · чернетка, у стрічці його поки не видно'}
            </p>
          </Card>
          {/**
           * Найважливіше попередження на цій сторінці. Якщо нормалізатор не
           * впізнав частину складу, перевірка алергій вище не має повних
           * даних — і мовчання фільтра тут означає «не знаю», а не «безпечно».
           */}
          {!row.compositionVerified && (
            <Card className="mb-3 bg-warn-50">
              <p className="text-[12px] leading-relaxed text-[#8a6200]">
                ⚠️ Склад розпізнано не повністю{unknown.length > 0 && ` (${unknown.join(', ')})`}.
                Перевірку на алергії за цим рецептом вважати повною не можна — звіряйте склад
                самостійно.
              </p>
            </Card>
          )}
        </>
      }
      actions={
        <RecipeActions
          slug={recipe.slug}
          source="community"
          title={recipe.title}
          servings={servings}
          baseServings={recipe.servings}
          missingCount={coverage.missing.filter((m) => !m.optional).length}
          missingCost={coverage.approxMissingCost}
        />
      }
    />
  )
}

function safeArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
