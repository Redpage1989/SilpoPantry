import { notFound, redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { loadPantry } from '@/lib/agent/tools'
import { prisma } from '@/lib/db'
import { SEED_RECIPES } from '@/lib/seed/recipes'
import { calculateMissingIngredients } from '@/lib/domain/matching'
import { checkRecipeAgainstRestrictions } from '@/lib/domain/restrictions'
import { RecipeDetail } from '../RecipeDetail'
import { RecipeActions } from './RecipeActions'
import type { Restriction } from '@/lib/domain/types'

export const dynamic = 'force-dynamic'

export default async function RecipePage({
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
  const recipe = SEED_RECIPES.find((r) => r.slug === slug)
  if (!recipe) notFound()

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

  return (
    <RecipeDetail
      recipe={recipe}
      coverage={coverage}
      check={check}
      servings={servings}
      backHref="/recipes"
      backLabel="До списку страв"
      actions={
        <RecipeActions
          slug={recipe.slug}
          source="book"
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
