'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Badge, Button, Card, InfoNote, ModeBadge, SectionTitle } from '@/components/ui'
import { apiPost, apiPut, ApiError } from '@/lib/client'
import { formatUah, pluralize } from '@/lib/domain/scoring'
import { formatQuantity } from '@/lib/domain/units'
import { displayName } from '@/lib/domain/normalize'
import { MEAL_LABELS, type MealType, type Unit } from '@/lib/domain/types'

interface PlannedMeal {
  mealType: MealType
  recipe: { id: string; slug: string; title: string; imageEmoji: string; cookingTime: number }
  servings: number
  missingCost: number
  rescues: string[]
  reason: string
  coverage: number
}

interface PlannedDay {
  dayOffset: number
  date: string
  isWeekend: boolean
  meals: PlannedMeal[]
}

interface PlanResponse {
  mode: 'live' | 'mock'
  modeReason: string
  durationMs: number
  liveMcpCalls: number
  agentPlan: { n: number; tool: string; why: string }[]
  plan: {
    days: PlannedDay[]
    shoppingList: { normalizedName: string; name: string; quantity: number; unit: Unit; approxCost: number; usedInMeals: number }[]
    totalMissingCost: number
    rescuedProducts: string[]
    atRiskProducts: string[]
    budget: { limit: number | null; planned: number; withinBudget: boolean }
    unfilledSlots: number
  }
  proposal: { proposalId: string; confirmationToken: string; total: number } | null
}

const DAY_NAMES = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

export function WeekPlanner() {
  const router = useRouter()
  const [days, setDays] = useState(7)
  const [mealsPerDay, setMealsPerDay] = useState(3)
  const [budgetUah, setBudgetUah] = useState(1000)
  const [saved, setSaved] = useState<number | null>(null)
  const [added, setAdded] = useState<{ lines: number; total: number } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const generate = useMutation({
    mutationFn: () =>
      apiPost<PlanResponse>('/api/plan', { days, mealsPerDay, budget: budgetUah > 0 ? budgetUah * 100 : null }),
    onSuccess: () => {
      setSaved(null)
      setAdded(null)
      setConfirming(false)
    },
  })

  const save = useMutation({
    mutationFn: async () => {
      const data = generate.data
      if (!data) throw new Error('Спершу побудуйте раціон')
      return apiPut<{ saved: number }>('/api/plan', {
        days: data.plan.days.map((d) => ({
          dayOffset: d.dayOffset,
          date: d.date,
          meals: d.meals.map((m) => ({
            mealType: m.mealType,
            recipeId: m.recipe.id,
            servings: m.servings,
          })),
        })),
      })
    },
    onSuccess: (res) => setSaved(res.saved),
  })

  const addToCart = useMutation({
    mutationFn: async () => {
      const proposal = generate.data?.proposal
      if (!proposal) throw new Error('Докуповувати нічого')
      return apiPost<{ cart: { total: number; lines: unknown[] } }>('/api/cart/confirm', {
        proposalId: proposal.proposalId,
        confirmationToken: proposal.confirmationToken,
      })
    },
    onSuccess: (res) => {
      setAdded({ lines: res.cart.lines.length, total: res.cart.total })
      setConfirming(false)
    },
  })

  useEffect(() => {
    generate.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = generate.data

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3">
          <Row label={`Днів у плані: ${days}`}>
            <input
              type="range"
              min={1}
              max={14}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full accent-[var(--color-accent-500)]"
              aria-label="Кількість днів"
            />
          </Row>
          <Row label={`Прийомів їжі на день: ${mealsPerDay}`}>
            <input
              type="range"
              min={1}
              max={4}
              value={mealsPerDay}
              onChange={(e) => setMealsPerDay(Number(e.target.value))}
              className="w-full accent-[var(--color-accent-500)]"
              aria-label="Прийомів їжі на день"
            />
          </Row>
          <Row label={`Бюджет на докупівлю: ${budgetUah > 0 ? `${budgetUah} грн` : 'без обмеження'}`}>
            <input
              type="range"
              min={0}
              max={5000}
              step={100}
              value={budgetUah}
              onChange={(e) => setBudgetUah(Number(e.target.value))}
              className="w-full accent-[var(--color-accent-500)]"
              aria-label="Бюджет"
            />
          </Row>
          <Button full onClick={() => generate.mutate()} disabled={generate.isPending}>
            {generate.isPending ? 'Агент планує тиждень…' : 'Скласти раціон'}
          </Button>
        </div>
      </Card>

      {generate.isError && (
        <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">
          {generate.error instanceof ApiError ? generate.error.message : 'Не вдалося скласти раціон'}
        </div>
      )}

      {data && (
        <>
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] text-graphite-500">
              {data.agentPlan.length} кроків · {data.durationMs} мс
              {data.liveMcpCalls > 0 && ` · ${data.liveMcpCalls} live MCP`}
            </span>
            <ModeBadge mode={data.mode} reason={data.modeReason} />
          </div>

          {/* Підсумок */}
          <Card>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Metric label="Страв" value={String(data.plan.days.reduce((s, d) => s + d.meals.length, 0))} />
              <Metric label="Докупити" value={formatUah(data.plan.totalMissingCost)} />
              <Metric label="Врятовано" value={String(data.plan.rescuedProducts.length)} />
            </div>
            {!data.plan.budget.withinBudget && data.plan.budget.limit !== null && (
              <div className="mt-3 rounded-2xl bg-warn-50 p-3 text-[12px] text-[#8a6200]">
                План перевищує бюджет: {formatUah(data.plan.budget.planned)} проти{' '}
                {formatUah(data.plan.budget.limit)}. Зменште кількість днів або прийомів їжі.
              </div>
            )}
            {data.plan.atRiskProducts.length > 0 && (
              <div className="mt-3 rounded-2xl bg-danger-50 p-3 text-[12px] text-danger-700">
                ⚠️ Зіпсуються, бо жодна страва їх не використовує:{' '}
                {data.plan.atRiskProducts.map(displayName).join(', ')}
              </div>
            )}
            {data.plan.unfilledSlots > 0 && (
              <div className="mt-3 text-[12px] text-graphite-500">
                {data.plan.unfilledSlots} слотів лишились без страви — у книзі бракує варіантів
                під ці умови.
              </div>
            )}
          </Card>

          {/* Дні */}
          <SectionTitle>Розклад</SectionTitle>
          <div className="space-y-3">
            {data.plan.days.map((day) => {
              const date = new Date(day.date)
              return (
                <Card key={day.dayOffset} className={day.isWeekend ? 'border border-accent-300' : undefined}>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-[14px] font-semibold">
                      {DAY_NAMES[date.getDay()]}, {date.toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' })}
                      {day.dayOffset === 0 && ' · сьогодні'}
                    </span>
                    {day.isWeekend && <Badge tone="accent">вихідний</Badge>}
                  </div>
                  {day.meals.length === 0 && (
                    <p className="text-[13px] text-graphite-500">Страв не підібрано.</p>
                  )}
                  <ul className="divide-y divide-cream-200">
                    {day.meals.map((meal) => (
                      <li key={`${meal.mealType}-${meal.recipe.id}`} className="py-2 first:pt-0 last:pb-0">
                        <Link href={`/recipes/${meal.recipe.slug}?servings=${meal.servings}`} className="flex gap-3">
                          <span className="text-2xl" aria-hidden>
                            {meal.recipe.imageEmoji}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="text-[11px] font-medium uppercase tracking-wide text-graphite-300">
                                {MEAL_LABELS[meal.mealType]}
                              </span>
                              <span className="shrink-0 text-[11px] text-graphite-500">
                                ⏱ {meal.recipe.cookingTime} хв · {Math.round(meal.coverage * 100)}%
                              </span>
                            </span>
                            <span className="block text-[14px] font-medium leading-tight">
                              {meal.recipe.title}
                            </span>
                            {meal.rescues.length > 0 && (
                              <span className="mt-1 inline-block rounded-full bg-success-50 px-2 py-0.5 text-[10px] font-medium text-[#1f6b3a]">
                                рятує: {meal.rescues.map(displayName).join(', ')}
                              </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )
            })}
          </div>

          {/* Список покупок */}
          {data.plan.shoppingList.length > 0 ? (
            <>
              <SectionTitle>
                Один список на {data.plan.days.length}{' '}
                {pluralize(data.plan.days.length, 'день', 'дні', 'днів')}
              </SectionTitle>
              <Card padded={false} className="overflow-hidden">
                <ul className="divide-y divide-cream-200">
                  {data.plan.shoppingList.map((i) => (
                    <li key={i.normalizedName} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium leading-tight">{displayName(i.name)}</div>
                        <div className="text-[11px] text-graphite-500">
                          {formatQuantity(i.quantity, i.unit)}
                          {i.usedInMeals > 1 && ` · для ${i.usedInMeals} страв`}
                        </div>
                      </div>
                      <span className="shrink-0 text-[14px] font-semibold">{formatUah(i.approxCost)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : (
            <InfoNote>Докуповувати нічого — усе для цього раціону вже є вдома.</InfoNote>
          )}

          {/* Дії */}
          <div className="space-y-2">
            {saved !== null ? (
              <Card className="bg-success-50">
                <div className="text-[14px] font-semibold text-[#1f6b3a]">Раціон збережено</div>
                <p className="mt-1 text-[12px] text-graphite-700">
                  {saved} страв у календарі харчування. Після приготування списуйте продукти
                  кнопкою «Я це приготував» у рецепті.
                </p>
              </Card>
            ) : (
              <Button full variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending ? 'Зберігаю…' : '📅 Зберегти раціон'}
              </Button>
            )}

            {added ? (
              <Card className="bg-success-50">
                <div className="text-[14px] font-semibold text-[#1f6b3a]">Список додано до кошика</div>
                <p className="mt-1 text-[12px] text-graphite-700">
                  У кошику {added.lines} позицій на {formatUah(added.total)}.
                </p>
                <Button full variant="secondary" className="mt-3" onClick={() => router.push('/cart')}>
                  Відкрити кошик
                </Button>
              </Card>
            ) : data.proposal ? (
              confirming ? (
                <Card className="border border-accent-300">
                  <div className="text-[14px] font-semibold">Підтвердіть зміну кошика</div>
                  <p className="mt-1 text-[12px] text-graphite-500">
                    До кошика «Сільпо» буде додано {data.plan.shoppingList.length} позицій на{' '}
                    {formatUah(data.proposal.total)}.
                  </p>
                  {addToCart.isError && (
                    <div className="mt-2 rounded-2xl bg-danger-50 p-2.5 text-[12px] text-danger-700">
                      {addToCart.error instanceof ApiError ? addToCart.error.message : 'Не вдалося додати'}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      Скасувати
                    </Button>
                    <Button onClick={() => addToCart.mutate()} disabled={addToCart.isPending}>
                      {addToCart.isPending ? 'Додаю…' : 'Так, додати'}
                    </Button>
                  </div>
                </Card>
              ) : (
                <>
                  <Button full onClick={() => setConfirming(true)}>
                    🛒 Додати список до кошика · {formatUah(data.proposal.total)}
                  </Button>
                  <p className="text-center text-[11px] text-graphite-300">
                    Кошик ще не змінено. Це відбудеться лише після підтвердження.
                  </p>
                </>
              )
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-graphite-700">{label}</div>
      {children}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-graphite-500">{label}</div>
      <div className="text-[16px] font-bold text-graphite-900">{value}</div>
    </div>
  )
}
