'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Badge, Button, Card, InfoNote, ModeBadge, SectionTitle } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'
import { formatUah, pluralize } from '@/lib/domain/scoring'
import { formatQuantity } from '@/lib/domain/units'
import { isBelowWeightMinimum, pricePerHundred } from '@/lib/domain/pricing'
import { TIER_LABELS, type ProductTier, type Unit } from '@/lib/domain/types'
import { AgentTrace } from '@/components/AgentTrace'
import type { TraceStep } from '@/lib/agent/tools'

interface TierOption {
  tier: ProductTier
  product: {
    productId: string
    companyId?: string
    branchId?: string
    name: string
    brand?: string
    price: number
    promoPrice?: number
    rating?: number
    packSize: number
    unit: Unit
    weighted?: boolean
  }
  quantity: number
  lineTotal: number
  /** вартість тієї частини упаковки, яку страва справді спожиє */
  consumedValue: number
  promoSaving: number
  rationale: string
}

interface Comparison {
  ingredient: { name: string; normalizedName: string; missing: number; unit: Unit }
  tiers: TierOption[]
  safety: { productId: string; safe: boolean; unknownComposition: boolean; messages: string[] }[]
}

interface DishPlanResponse {
  mode: 'live' | 'mock'
  modeReason: string
  liveMcpCalls: number
  durationMs: number
  plan: { n: number; tool: string; why: string }[]
  trace: TraceStep[]
  recipe: { id: string; slug: string; title: string; imageEmoji: string; cookingTime: number; servings: number; summary: string }
  scored: { reason: string; coverage: { coverage: number; have: { name: string }[]; missing: { name: string; optional: boolean }[] } }
  servings: number
  comparisons: Comparison[]
  cookVsReady: {
    comparison: {
      cook: {
        totalCost: number
        consumedCost: number
        leftoverValue: number
        minutes: number
        servings: number
        costPerServing: number
      }
      ready: { product: { name: string; price: number; promoPrice?: number }; quantity: number; totalCost: number; servings: number; costPerServing: number } | null
      recommendation: 'cook' | 'ready' | 'tie'
      explanation: string
    }
    alternatives: { productId: string; name: string; price: number; promoPrice?: number }[]
  }
  proposal: { proposalId: string; confirmationToken: string; total: number } | null
  /** тижневий бюджет родини; null, якщо не заданий */
  weeklyBudget: number | null
  totalsByTier: Record<string, number>
}

const TIER_ORDER: ProductTier[] = ['budget', 'optimal', 'premium']

export function DishPlanner({ initialQuery, initialServings }: { initialQuery: string; initialServings?: number }) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [servings, setServings] = useState(initialServings ?? 6)
  const [tier, setTier] = useState<ProductTier>('optimal')
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState(false)
  const [added, setAdded] = useState<{ total: number; lines: number; checkoutUrl: string | null } | null>(null)
  const [showTrace, setShowTrace] = useState(false)

  const plan = useMutation({
    mutationFn: (input: { query: string; servings: number }) =>
      apiPost<DishPlanResponse>('/api/dish-plan', input),
    onSuccess: () => {
      setChosen({})
      setAdded(null)
    },
  })

  const confirm = useMutation({
    mutationFn: async () => {
      const data = plan.data
      if (!data?.proposal) throw new Error('Немає пропозиції для підтвердження')
      /**
       * Надсилаємо ЛИШЕ ідентифікатори обраних товарів. Ціну, вагу й крок
       * сервер бере зі своєї пропозиції — браузер не має права повідомляти,
       * скільки важить товар.
       */
      const selection = data.comparisons
        .map((c) => {
          const productId = chosen[c.ingredient.normalizedName]
          const option = productId
            ? c.tiers.find((t) => t.product.productId === productId)
            : c.tiers.find((t) => t.tier === tier) ?? c.tiers[0]
          return option?.product.productId ?? null
        })
        .filter((id): id is string => id !== null)

      return apiPost<{ cart: { total: number; lines: unknown[]; checkoutUrl: string | null } }>('/api/cart/confirm', {
        proposalId: data.proposal.proposalId,
        confirmationToken: data.proposal.confirmationToken,
        tier,
        selection,
      })
    },
    onSuccess: (res) => {
      setAdded({ total: res.cart.total, lines: res.cart.lines.length, checkoutUrl: res.cart.checkoutUrl })
      setConfirming(false)
    },
  })

  useEffect(() => {
    plan.mutate({ query: initialQuery, servings: initialServings ?? 6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = plan.data

  /**
   * Один похідний стан для ВСІХ сум на екрані.
   *
   * До цього кнопка підтвердження рахувала вибір користувача, а картки
   * рівнів і блок «готувати чи купити» показували цифри, що прийшли з
   * сервера для рівня «Оптимальний». Після зміни одного товару на екрані
   * одночасно жили три різні відповіді на питання «скільки я заплачу».
   */
  const effective = data
    ? data.comparisons.map((c) => {
        const productId = chosen[c.ingredient.normalizedName]
        return productId
          ? c.tiers.find((t) => t.product.productId === productId) ?? c.tiers[0]
          : c.tiers.find((t) => t.tier === tier) ?? c.tiers[0]
      })
    : []

  /** чи відхилився вибір від суцільного цінового рівня */
  const mixed = data ? data.comparisons.some((c) => {
    const productId = chosen[c.ingredient.normalizedName]
    if (!productId) return false
    const forTier = c.tiers.find((t) => t.tier === tier) ?? c.tiers[0]
    return forTier?.product.productId !== productId
  }) : false

  const selectedTotal = effective.reduce((sum, o) => sum + (o?.lineTotal ?? 0), 0)
  const selectedConsumed = effective.reduce((sum, o) => sum + (o?.consumedValue ?? o?.lineTotal ?? 0), 0)
  const selectedLeftover = Math.max(0, selectedTotal - selectedConsumed)
  const servingsCount = data?.servings ?? 1
  const cookPerServing = servingsCount > 0 ? Math.round(selectedConsumed / servingsCount) : selectedConsumed
  const readyTotal = data?.cookVsReady.comparison.ready?.totalCost ?? null

  /**
   * Чи вибір виходить за тижневий бюджет родини.
   *
   * Застосунок знав бюджет від початку і мовчки пропонував страву, дорожчу за
   * весь тиждень. Це не привід блокувати вибір — людина має право на десерт, —
   * але промовчати про це означає працювати на кошик, а не на родину.
   */
  const budget = data?.weeklyBudget ?? null
  const overBudget = budget !== null && budget > 0 && selectedTotal > budget
  const cheapestTotal = data?.totalsByTier.budget ?? 0
  /** той самий поріг, що й на сервері: різниця до 20 грн — нічия */
  const verdict: 'cook' | 'ready' | 'tie' =
    readyTotal === null ? 'cook' : Math.abs(readyTotal - selectedConsumed) < 2000 ? 'tie' : readyTotal > selectedConsumed ? 'cook' : 'ready'

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Назва страви"
            placeholder="Наприклад, тірамісу"
            className="min-h-[46px] flex-1 rounded-2xl bg-cream-100 px-4 text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
          />
          <input
            inputMode="numeric"
            value={String(servings)}
            onChange={(e) => setServings(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
            aria-label="Кількість порцій"
            className="min-h-[46px] w-16 rounded-2xl bg-cream-100 px-3 text-center text-[15px] outline-none focus:ring-2 focus:ring-accent-700"
          />
        </div>
        <Button full className="mt-2" onClick={() => plan.mutate({ query, servings })} disabled={plan.isPending}>
          {plan.isPending ? 'Агент працює…' : 'Спланувати'}
        </Button>
      </Card>

      {plan.isError && (
        <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">
          {plan.error instanceof ApiError ? plan.error.message : 'Не вдалося спланувати страву'}
        </div>
      )}

      {data && (
        <>
          <div className="flex items-center justify-between px-1">
            <span className="text-[12px] text-graphite-500">
              {data.plan.length} кроків агента · {data.durationMs} мс
              {data.liveMcpCalls > 0 && ` · ${data.liveMcpCalls} live MCP`}
            </span>
            <ModeBadge mode={data.mode} reason={data.modeReason} />
          </div>

          {/* Рецепт */}
          <Card>
            <div className="flex gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-cream-200 text-3xl" aria-hidden>
                {data.recipe.imageEmoji}
              </div>
              <div className="min-w-0">
                <h2 className="text-[17px] font-semibold leading-tight">{data.recipe.title}</h2>
                <p className="text-[12px] text-graphite-500">{data.recipe.summary}</p>
                <div className="mt-1 flex gap-2 text-[11px] text-graphite-500">
                  <span>⏱ {data.recipe.cookingTime} хв</span>
                  <span>· {data.servings} порц.</span>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-snug text-graphite-700">{data.scored.reason}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
              <div className="rounded-2xl bg-success-50 p-2.5">
                <div className="font-semibold text-[#1f6b3a]">Є вдома</div>
                <div className="mt-0.5">{data.scored.coverage.have.map((h) => h.name).join(', ') || '—'}</div>
              </div>
              <div className="rounded-2xl bg-accent-50 p-2.5">
                <div className="font-semibold text-accent-700">Не вистачає</div>
                <div className="mt-0.5">
                  {data.scored.coverage.missing.filter((m) => !m.optional).map((m) => m.name).join(', ') || '—'}
                </div>
              </div>
            </div>
          </Card>

          {/* Ціновий рівень */}
          {data.comparisons.length > 0 && (
            <>
              <SectionTitle>Оберіть рівень</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                {TIER_ORDER.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTier(t)
                      setChosen({})
                    }}
                    className={`rounded-2xl p-3 text-left transition-colors ${
                      tier === t ? 'bg-accent-500 text-graphite-900' : 'bg-white text-graphite-900'
                    }`}
                  >
                    <div className="text-[12px] font-semibold">{TIER_LABELS[t]}</div>
                    <div className="mt-1 text-[15px] font-bold">{formatUah(data.totalsByTier[t] ?? 0)}</div>
                  </button>
                ))}
              </div>

              <SectionTitle>Відсутні інгредієнти ({data.comparisons.length})</SectionTitle>
              {data.comparisons.map((c) => {
                const activeId =
                  chosen[c.ingredient.normalizedName] ??
                  (c.tiers.find((t) => t.tier === tier) ?? c.tiers[0])?.product.productId
                return (
                  <Card key={c.ingredient.normalizedName}>
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <h3 className="text-[15px] font-semibold">{c.ingredient.name}</h3>
                      <span className="text-[12px] text-graphite-500">
                        треба {formatQuantity(c.ingredient.missing, c.ingredient.unit)}
                      </span>
                    </div>
                    {c.tiers.length === 0 && (
                      <p className="text-[13px] text-graphite-500">Товарів не знайдено в каталозі.</p>
                    )}
                    <div className="space-y-2">
                      {c.tiers.map((t) => {
                        const safety = c.safety.find((s) => s.productId === t.product.productId)
                        const active = activeId === t.product.productId
                        return (
                          <button
                            key={t.product.productId}
                            onClick={() =>
                              setChosen((prev) => ({ ...prev, [c.ingredient.normalizedName]: t.product.productId }))
                            }
                            className={`w-full rounded-2xl border p-3 text-left transition-colors ${
                              active ? 'border-accent-500 bg-accent-50' : 'border-cream-200 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <Badge tone={t.tier === 'budget' ? 'info' : t.tier === 'optimal' ? 'success' : 'accent'}>
                                  {TIER_LABELS[t.tier]}
                                </Badge>
                                <div className="mt-1 text-[14px] font-medium leading-tight">{t.product.name}</div>
                                <div className="text-[11px] text-graphite-500">
                                  {/* «1 × 1 уп» нічого не повідомляє — каталог не дав ваги */}
                                  {t.product.unit === 'уп'
                                    ? t.quantity === 1
                                      ? '1 упаковка'
                                      : `${t.quantity} упаковки`
                                    : `${t.quantity} × ${t.product.packSize} ${t.product.unit}`}
                                  {t.product.rating ? ` · ${t.product.rating}★` : ''}
                                </div>
                                {/*
                                  Питома ціна — те, за чим рівні впорядковані насправді.
                                  Без неї «Преміальний 159 грн» поруч з «Оптимальний 279 грн»
                                  читається як помилка розрахунку, хоча різні лише фасовки.
                                */}
                                {pricePerHundred(t.product) !== null && (
                                  <div className="text-[11px] font-medium text-graphite-700">
                                    {formatUah(pricePerHundred(t.product)!)} за 100{' '}
                                    {t.product.unit === 'мл' || t.product.unit === 'л' ? 'мл' : 'г'}
                                  </div>
                                )}
                                <div className="mt-1 text-[11px] text-graphite-500">{t.rationale}</div>
                                {/* Інакше людина бачить у кошику більше, ніж у рецепті, і не розуміє чому */}
                                {isBelowWeightMinimum(c.ingredient.missing, c.ingredient.unit, t.product) && (
                                  <div className="mt-1 text-[11px] text-graphite-500">
                                    ⚖️ Рецепту треба {formatQuantity(c.ingredient.missing, c.ingredient.unit)}, але
                                    цей товар відпускають кратно{' '}
                                    {formatQuantity(t.product.packSize, t.product.unit)}
                                  </div>
                                )}
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-[15px] font-bold">{formatUah(t.lineTotal)}</div>
                                {t.promoSaving > 0 && (
                                  <div className="text-[11px] font-medium text-success-500">
                                    −{formatUah(t.promoSaving)} акція
                                  </div>
                                )}
                              </div>
                            </div>
                            {safety && !safety.safe && (
                              <div className="mt-2 rounded-xl bg-danger-50 p-2 text-[11px] text-danger-700">
                                ⚠️ {safety.messages.join('; ')}
                              </div>
                            )}
                            {safety?.unknownComposition && safety.messages.length > 0 && safety.safe && (
                              <div className="mt-2 rounded-xl bg-warn-50 p-2 text-[11px] text-[#8a6200]">
                                {safety.messages.join('; ')}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </Card>
                )
              })}
            </>
          )}

          {/* Готувати vs купити */}
          <SectionTitle>Приготувати вдома чи купити готове?</SectionTitle>
          <Card>
            <div className="grid grid-cols-2 gap-3">
              <div
                className={`rounded-2xl p-3 ${
                  verdict === 'cook' ? 'bg-success-50' : 'bg-cream-100'
                }`}
              >
                <div className="text-[12px] font-semibold text-graphite-700">👩‍🍳 Приготувати</div>
                <div className="mt-1 text-[18px] font-bold">
                  {formatUah(selectedConsumed)}
                </div>
                <div className="text-[11px] text-graphite-500">
                  {formatUah(cookPerServing)} / порція
                </div>
                <div className="mt-1 text-[11px] text-graphite-500">
                  ⏱ {data.cookVsReady.comparison.cook.minutes} хв
                </div>
                {selectedLeftover > 0 && (
                  <div className="mt-1 text-[11px] leading-snug text-graphite-500">
                    заплатити {formatUah(selectedTotal)}, з них{' '}
                    {formatUah(selectedLeftover)} лишиться про запас
                  </div>
                )}
              </div>
              <div
                className={`rounded-2xl p-3 ${
                  verdict === 'ready' ? 'bg-success-50' : 'bg-cream-100'
                }`}
              >
                <div className="text-[12px] font-semibold text-graphite-700">🛍️ Купити готове</div>
                {data.cookVsReady.comparison.ready ? (
                  <>
                    <div className="mt-1 text-[18px] font-bold">
                      {formatUah(data.cookVsReady.comparison.ready.totalCost)}
                    </div>
                    <div className="text-[11px] text-graphite-500">
                      {formatUah(data.cookVsReady.comparison.ready.costPerServing)} / порція
                    </div>
                    <div className="mt-1 truncate text-[11px] text-graphite-500">
                      {data.cookVsReady.comparison.ready.product.name}
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-[13px] text-graphite-500">Немає в каталозі</div>
                )}
              </div>
            </div>
            <p className="mt-3 text-[13px] leading-snug text-graphite-700">
              {/* Серверне пояснення описує рівень, а не поточний вибір: щойно
                  користувач змінив товар, воно говорить про інші суми */}
              {mixed && readyTotal !== null
                ? verdict === 'cook'
                  ? `З вашим вибором приготувати вдома дешевше на ${formatUah(readyTotal - selectedConsumed)} (${formatUah(cookPerServing)} проти ${formatUah(data.cookVsReady.comparison.ready!.costPerServing)} за порцію), але займе ${data.cookVsReady.comparison.cook.minutes} хв.`
                  : verdict === 'ready'
                    ? `З вашим вибором готове дешевше на ${formatUah(selectedConsumed - readyTotal)} і економить ${data.cookVsReady.comparison.cook.minutes} хв.`
                    : `З вашим вибором різниця в ціні незначна (${formatUah(Math.abs(readyTotal - selectedConsumed))}). Питання лише в часі.`
                : data.cookVsReady.comparison.explanation}
            </p>
            {data.cookVsReady.alternatives.length > 0 && (
              <div className="mt-3 border-t border-cream-200 pt-2">
                <div className="text-[12px] font-medium text-graphite-700">Готові альтернативи в каталозі</div>
                <ul className="mt-1 space-y-1">
                  {data.cookVsReady.alternatives.slice(0, 3).map((a) => (
                    <li key={a.productId} className="flex justify-between gap-2 text-[12px]">
                      <span className="min-w-0 truncate text-graphite-700">{a.name}</span>
                      <span className="shrink-0 font-medium">{formatUah(a.promoPrice ?? a.price)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* Підтвердження */}
          {added ? (
            <Card className="bg-success-50">
              <div className="text-[15px] font-semibold text-[#1f6b3a]">Товари додано до кошика</div>
              <p className="mt-1 text-[13px] text-graphite-700">
                У кошику {added.lines}{' '}
                {pluralize(added.lines, 'позиція', 'позиції', 'позицій')} на {formatUah(added.total)}.
                {added.total > selectedTotal && (
                  <>
                    {' '}
                    Це {formatUah(selectedTotal)} за товари плюс{' '}
                    {formatUah(added.total - selectedTotal)} доставки.
                  </>
                )}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => router.push('/cart')}>
                  Відкрити кошик
                </Button>
                {added.checkoutUrl && (
                  <a
                    href={added.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[48px] items-center justify-center rounded-2xl bg-accent-500 px-5 text-[15px] font-semibold text-graphite-900"
                  >
                    Перейти до оформлення
                  </a>
                )}
              </div>
            </Card>
          ) : data.proposal ? (
            <Card className="border border-accent-300">
              {!confirming ? (
                <>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-semibold">До кошика буде додано</span>
                    <span className="text-[18px] font-bold">{formatUah(selectedTotal)}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-graphite-500">
                    {data.comparisons.length}{' '}
                    {pluralize(data.comparisons.length, 'позиція', 'позиції', 'позицій')} ·{' '}
                    {mixed ? 'ваш власний вибір' : `рівень «${TIER_LABELS[tier]}»`}
                  </p>
                  {overBudget && (
                    <div className="mt-3 rounded-2xl bg-warn-50 p-3 text-[12px] leading-snug text-[#8a6200]">
                      Це {formatUah(selectedTotal)} — більше за ваш тижневий бюджет{' '}
                      {formatUah(budget!)}.
                      {/*
                        Дешевший рівень пропонуємо ЛИШЕ якщо він справді
                        вкладається в бюджет. Інакше це порада, яка проблеми
                        не вирішує, — а виглядає як вирішення.
                      */}
                      {cheapestTotal > 0 && cheapestTotal < selectedTotal && cheapestTotal <= budget! && (
                        <>
                          {' '}
                          Бюджетний рівень вкладається — {formatUah(cheapestTotal)}.
                        </>
                      )}
                      {cheapestTotal > 0 && cheapestTotal < selectedTotal && cheapestTotal > budget! && (
                        <>
                          {' '}
                          Навіть бюджетний рівень виходить за нього ({formatUah(cheapestTotal)}),
                          тож ідеться про свідому витрату.
                        </>
                      )}
                    </div>
                  )}
                  <Button full className="mt-3" onClick={() => setConfirming(true)}>
                    Додати до кошика
                  </Button>
                  <p className="mt-2 text-center text-[11px] text-graphite-300">
                    Кошик ще не змінено. Це відбудеться лише після підтвердження.
                  </p>
                </>
              ) : (
                <>
                  <div className="text-[15px] font-semibold">Підтвердіть зміну кошика</div>
                  <ul className="mt-2 divide-y divide-cream-200">
                    {data.comparisons.map((c) => {
                      const productId = chosen[c.ingredient.normalizedName]
                      const option = productId
                        ? c.tiers.find((t) => t.product.productId === productId)
                        : c.tiers.find((t) => t.tier === tier) ?? c.tiers[0]
                      if (!option) return null
                      return (
                        <li key={c.ingredient.normalizedName} className="flex justify-between gap-2 py-2 text-[13px]">
                          <span className="min-w-0 truncate">
                            {option.product.name} × {option.quantity}
                          </span>
                          <span className="shrink-0 font-medium">{formatUah(option.lineTotal)}</span>
                        </li>
                      )
                    })}
                  </ul>
                  <div className="mt-2 flex justify-between text-[15px] font-bold">
                    <span>Разом</span>
                    <span>{formatUah(selectedTotal)}</span>
                  </div>
                  {confirm.isError && (
                    <div className="mt-2 rounded-2xl bg-danger-50 p-2.5 text-[12px] text-danger-700">
                      {confirm.error instanceof ApiError ? confirm.error.message : 'Не вдалося додати'}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button variant="ghost" onClick={() => setConfirming(false)}>
                      Скасувати
                    </Button>
                    <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                      {confirm.isPending ? 'Додаю…' : 'Так, додати'}
                    </Button>
                  </div>
                </>
              )}
            </Card>
          ) : (
            <InfoNote>Докуповувати нічого не потрібно — усі інгредієнти вже є вдома.</InfoNote>
          )}

          <button
            onClick={() => setShowTrace((v) => !v)}
            className="min-h-[44px] w-full text-center text-[13px] font-medium text-accent-700"
          >
            {showTrace ? 'Сховати кроки агента' : 'Показати кроки агента'}
          </button>
          {showTrace && <AgentTrace plan={data.plan} trace={data.trace} mode={data.mode} />}
        </>
      )}
    </div>
  )
}
