import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { loadPantry } from '@/lib/agent/tools'
import { prisma } from '@/lib/db'
import { SEED_RECIPES } from '@/lib/seed/recipes'
import { calculateMissingIngredients } from '@/lib/domain/matching'
import { checkRecipeAgainstRestrictions } from '@/lib/domain/restrictions'
import { formatUah } from '@/lib/domain/scoring'
import { formatQuantity } from '@/lib/domain/units'
import { AllergyWarning, Badge, Card, SectionTitle } from '@/components/ui'
import { RecipeActions } from './RecipeActions'
import { TIP_EMOJI, TIP_LABELS, type Restriction } from '@/lib/domain/types'

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
  const multiplier = servings / recipe.servings

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <Link href="/recipes" className="mb-3 inline-block text-[13px] font-medium text-accent-600">
        ← До списку страв
      </Link>

      <header className="mb-4 flex gap-3">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[var(--radius-card)] bg-cream-200 text-4xl" aria-hidden>
          {recipe.imageEmoji}
        </div>
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">{recipe.title}</h1>
          <p className="mt-1 text-[13px] text-graphite-500">{recipe.summary}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral">⏱ {recipe.cookingTime} хв</Badge>
            <Badge tone="neutral">~{Math.round(recipe.nutrition.kcal)} ккал/порція</Badge>
            <Badge tone="neutral">{recipe.cuisine}</Badge>
          </div>
        </div>
      </header>

      {check.result === 'blocked' && (
        <div className="mb-4">
          <AllergyWarning>
            <strong>Ця страва не підходить вашій родині.</strong>
            <ul className="mt-1 list-disc pl-4">
              {check.violations.map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
            </ul>
          </AllergyWarning>
        </div>
      )}
      {check.result === 'warning' && (
        <Card className="mb-4 bg-warn-50">
          <div className="text-[13px] text-[#8a6200]">
            {check.violations.map((v) => v.message).join('; ')}
          </div>
        </Card>
      )}
      {check.allergyNotice && (
        <Card className="mb-4 bg-danger-50">
          <p className="text-[12px] leading-relaxed text-danger-700">⚠️ {check.allergyNotice}</p>
        </Card>
      )}

      <RecipeActions
        slug={recipe.slug}
        title={recipe.title}
        servings={servings}
        baseServings={recipe.servings}
        missingCount={coverage.missing.filter((m) => !m.optional).length}
        missingCost={coverage.approxMissingCost}
      />

      <SectionTitle>Інгредієнти на {servings} порц.</SectionTitle>
      <Card padded={false} className="mb-4 overflow-hidden">
        <ul className="divide-y divide-cream-200">
          {recipe.ingredients.map((ing) => {
            const missing = coverage.missing.find((m) => m.normalizedName === ing.normalizedName)
            const scaled = ing.quantity * multiplier
            return (
              <li key={ing.normalizedName} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium leading-tight">
                    {ing.name}
                    {ing.optional && <span className="ml-1 text-[11px] text-graphite-300">необовʼязково</span>}
                  </div>
                  <div className="text-[12px] text-graphite-500">
                    {formatQuantity(scaled, ing.unit)}
                    {ing.substitutes && ing.substitutes.length > 0 && (
                      <span> · заміна: {ing.substitutes.join(', ')}</span>
                    )}
                  </div>
                  {missing?.coveredBySubstitute && (
                    <div className="text-[11px] text-info-500">
                      покрито заміною: {missing.coveredBySubstitute.originalName}
                    </div>
                  )}
                </div>
                {!missing ? (
                  <Badge tone="success">є вдома</Badge>
                ) : (
                  <div className="text-right">
                    <Badge tone={missing.kind === 'absent' ? 'accent' : 'warn'}>
                      {missing.kind === 'absent' ? 'докупити' : 'не вистачає'}
                    </Badge>
                    <div className="mt-0.5 text-[11px] text-graphite-500">
                      {formatQuantity(missing.missing, missing.unit)} · ≈ {formatUah(missing.approxCost)}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Card>

      <SectionTitle>Приготування</SectionTitle>
      <Card className="mb-4">
        <ol className="space-y-3">
          {recipe.steps.map((s) => (
            <li key={s.step} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-100 text-[13px] font-semibold text-accent-700">
                {s.step}
              </span>
              <div className="min-w-0">
                <p className="text-[14px] leading-snug text-graphite-900">{s.text}</p>
                {s.timerMinutes && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-cream-200 px-2.5 py-1 text-[11px] font-medium text-graphite-700">
                    ⏱ таймер {s.timerMinutes} хв
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {recipe.tips && recipe.tips.length > 0 && (
        <>
          <SectionTitle>Поради</SectionTitle>
          <Card className="mb-4" padded={false}>
            <ul className="divide-y divide-cream-200">
              {recipe.tips.map((tip, i) => (
                <li key={i} className="flex gap-3 px-4 py-3">
                  <span className="text-base leading-none" aria-hidden>
                    {TIP_EMOJI[tip.kind]}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-graphite-300">
                      {TIP_LABELS[tip.kind]}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-snug text-graphite-700">{tip.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Card className="bg-cream-50">
        <div className="flex justify-between text-[13px]">
          <span className="text-graphite-500">Орієнтовна вартість докупівлі</span>
          <span className="font-semibold">{formatUah(coverage.approxMissingCost)}</span>
        </div>
        <div className="mt-1 flex justify-between text-[13px]">
          <span className="text-graphite-500">На одну порцію</span>
          <span className="font-semibold">
            {formatUah(Math.round(coverage.approxMissingCost / servings))}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-graphite-300">
          Оцінка за середніми цінами. Точна сума формується на екрані кошика після пошуку товарів у «Сільпо».
        </p>
      </Card>
    </main>
  )
}
