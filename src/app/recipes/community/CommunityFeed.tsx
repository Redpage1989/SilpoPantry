'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Badge, Button, Card, LinkButton, SectionTitle } from '@/components/ui'
import { apiGet, apiPost, ApiError } from '@/lib/client'
import { DIFFICULTY_LABELS, MEAL_LABELS, type Difficulty, type MealType } from '@/lib/domain/types'
import { pluralize } from '@/lib/domain/scoring'
import { MIN_VOTES_FOR_WINNER } from '@/lib/domain/user-recipes'

interface CommunityRecipe {
  id: string
  slug: string
  title: string
  summary: string
  servings: number
  cookingTime: number
  difficulty: Difficulty
  cuisine: string
  mealType: MealType
  imageEmoji: string
  compositionVerified: boolean
  declaredAllergens: string[]
  unknownIngredients: string[]
  isMine: boolean
  status: 'published' | 'draft' | 'hidden'
  /** причини автоперевірки — приходять лише авторові */
  moderationIssues: { code: string; severity: 'block' | 'warn'; message: string }[]
  /** скільки скарг — теж лише авторові */
  reports?: number
  votesTotal: number
  votesThisWeek: number
  votedByMe: boolean
  /** голос заробляється приготуванням — див. api/user-recipes/vote */
  cookedByMe: boolean
}

const REPORT_REASONS = [
  { value: 'unsafe', label: 'Небезпечна порада' },
  { value: 'spam', label: 'Реклама або спам' },
  { value: 'not_a_recipe', label: 'Це не рецепт' },
  { value: 'other', label: 'Інше' },
] as const

interface WeeklyAward {
  isoWeek: string
  weekLabelText: string
  title: string
  slug: string
  imageEmoji: string
  author: string
  isMine: boolean
  votes: number
  prizeBalabonuses: number
  status: string
  statusLabel: string
}

interface FeedResponse {
  isoWeek: string
  weekLabelText: string
  winner: { recipeId: string | null; votes: number; enoughVotes: boolean }
  board: { recipeId: string; votes: number; rank: number }[]
  boardThreshold: number
  weekVotesTotal: number
  prize: { balabonuses: number; awardedBy: string; confirmed: boolean }
  awards: WeeklyAward[]
  recipes: CommunityRecipe[]
}

export function CommunityFeed() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const feed = useQuery({
    queryKey: ['community'],
    queryFn: () => apiGet<FeedResponse>('/api/user-recipes'),
  })

  const vote = useMutation({
    mutationFn: (recipeId: string) => apiPost('/api/user-recipes/vote', { recipeId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['community'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Не вдалося проголосувати'),
  })

  const [reportingId, setReportingId] = useState<string | null>(null)
  const report = useMutation({
    mutationFn: (v: { recipeId: string; reason: string }) => apiPost<{ note: string }>('/api/user-recipes/report', v),
    onSuccess: (res) => {
      setReportingId(null)
      setNotice(res.note)
      qc.invalidateQueries({ queryKey: ['community'] })
    },
    onError: (err) => {
      setReportingId(null)
      setError(err instanceof ApiError ? err.message : 'Не вдалося надіслати скаргу')
    },
  })
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 4000)
      return () => clearTimeout(t)
    }
  }, [error])

  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(null), 6000)
      return () => clearTimeout(t)
    }
  }, [notice])

  const data = feed.data
  const winner = data?.recipes.find((r) => r.id === data.winner.recipeId)

  return (
    <div className="space-y-4">
      <LinkButton href="/recipes/new" full>
        ✍️ Додати свій рецепт
      </LinkButton>

      {error && <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>}
      {notice && <div className="rounded-2xl bg-cream-100 p-3 text-[13px] text-graphite-700">{notice}</div>}

      {feed.isLoading && <Card><p className="text-[13px] text-graphite-500">Завантажую…</p></Card>}

      {data && (
        <>
          {/* Рецепт тижня */}
          <Card className={winner ? 'border border-accent-300' : undefined}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">🏆 Рецепт тижня</h2>
              <span className="text-[11px] text-graphite-300">{data.weekLabelText}</span>
            </div>
            {winner ? (
              <div className="mt-2 flex gap-3">
                <span className="text-3xl" aria-hidden>{winner.imageEmoji}</span>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold leading-tight">{winner.title}</div>
                  <div className="text-[12px] text-graphite-500">
                    {data.winner.votes} {pluralize(data.winner.votes, 'голос', 'голоси', 'голосів')}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[13px] leading-snug text-graphite-500">
                {data.winner.votes > 0
                  ? `Лідер має ${data.winner.votes} ${pluralize(data.winner.votes, 'голос', 'голоси', 'голосів')}. Переможця оголосимо від ${MIN_VOTES_FOR_WINNER} — інакше це не вибір спільноти, а випадковість.`
                  : `Цього тижня ще ніхто не голосував. Переможець зʼявиться від ${MIN_VOTES_FOR_WINNER} голосів.`}
              </p>
            )}
          </Card>

          {/* Таблиця тижня. Зʼявляється лише коли є що ранжувати: три рядки
              по нулю голосів — це не рейтинг, а порожня рамка */}
          {data.board.length > 0 && (
            <Card padded={false} className="overflow-hidden">
              <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
                <h2 className="text-[15px] font-semibold">Таблиця тижня</h2>
                <span className="text-[11px] text-graphite-300">
                  {data.weekVotesTotal} {pluralize(data.weekVotesTotal, 'голос', 'голоси', 'голосів')}
                </span>
              </div>
              <ul className="mt-2 divide-y divide-cream-200">
                {data.board.map((row) => {
                  const r = data.recipes.find((x) => x.id === row.recipeId)
                  if (!r) return null
                  return (
                    <li key={row.recipeId} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className={`w-6 shrink-0 text-center text-[15px] font-bold ${
                          row.rank === 1 ? 'text-accent-700' : 'text-graphite-300'
                        }`}
                      >
                        {row.rank}
                      </span>
                      <span className="text-xl" aria-hidden>{r.imageEmoji}</span>
                      <Link
                        href={`/recipes/community/${r.slug}`}
                        className="min-w-0 flex-1 truncate text-[14px] font-medium leading-tight"
                      >
                        {r.title}
                      </Link>
                      <span className="shrink-0 text-[13px] font-semibold text-graphite-700">
                        {row.votes}
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="px-4 pb-3 pt-2 text-[11px] leading-relaxed text-graphite-300">
                Рахуються голоси лише цього тижня. Голос дає той, хто приготував страву, — тому
                накрутити його можна хіба що продуктами з власної комори.
              </p>
            </Card>
          )}

          {/* Приз переможцю */}
          <Card className="bg-accent-50">
            <div className="flex gap-3">
              <span className="text-2xl" aria-hidden>🎁</span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold leading-tight">
                  Приз автору — {data.prize.balabonuses} балабонусів
                </h2>
                <p className="mt-1 text-[13px] leading-snug text-graphite-500">
                  Коли тиждень завершується, переможець фіксується назавжди, і застосунок
                  формує заявку на нагородження від «{data.prize.awardedBy}».
                </p>
                {/**
                 * Найважливіший рядок на екрані. Нарахувати балабонуси зсередини
                 * неможливо: усі лояльнісні інструменти MCP — на читання. Обіцяти
                 * приз, якого ніхто не нарахує, гірше, ніж не мати призу взагалі.
                 */}
                {!data.prize.confirmed && (
                  <p className="mt-2 text-[11px] leading-relaxed text-graphite-500">
                    ⓘ Це механіка, запропонована застосунком, а не підтверджена акція
                    «Сільпо». Нарахування виконує «Сільпо» на своєму боці — у MCP немає
                    інструмента, який дозволяв би нам нарахувати бонуси самостійно.
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* Зал слави: закриті тижні */}
          {data.awards.length > 0 && (
            <>
              <SectionTitle>Переможці попередніх тижнів</SectionTitle>
              <Card padded={false} className="overflow-hidden">
                <ul className="divide-y divide-cream-200">
                  {data.awards.map((a) => (
                    <li key={a.isoWeek} className="flex items-center gap-3 px-4 py-3">
                      <span className="text-2xl" aria-hidden>{a.imageEmoji}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium leading-tight">{a.title}</div>
                        <div className="text-[11px] text-graphite-500">
                          {a.weekLabelText} · {a.author} · {a.votes}{' '}
                          {pluralize(a.votes, 'голос', 'голоси', 'голосів')}
                        </div>
                        <div className="mt-0.5 text-[11px] text-graphite-500">
                          {a.prizeBalabonuses} балабонусів — {a.statusLabel}
                        </div>
                      </div>
                      <Badge tone={a.status === 'granted' ? 'success' : 'neutral'}>
                        {a.status === 'granted' ? '🎁' : '⏳'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}

          <SectionTitle>
            {data.recipes.length} {pluralize(data.recipes.length, 'рецепт', 'рецепти', 'рецептів')} від спільноти
          </SectionTitle>

          {data.recipes.length === 0 && (
            <Card className="text-center">
              <div className="mb-2 text-4xl" aria-hidden>🍳</div>
              <p className="text-[13px] text-graphite-500">
                Тут поки порожньо. Будьте першим, хто поділиться сімейним рецептом.
              </p>
            </Card>
          )}

          {data.recipes.map((r) => (
            <Card key={r.id}>
              <div className="flex gap-3">
                <span className="text-3xl" aria-hidden>{r.imageEmoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold leading-tight">
                      {r.status === 'published' || r.isMine ? (
                        <Link href={`/recipes/community/${r.slug}`} className="hover:underline">
                          {r.title}
                        </Link>
                      ) : (
                        r.title
                      )}
                    </h3>
                    <div className="flex shrink-0 gap-1">
                      {r.status === 'draft' && <Badge tone="warn">чернетка</Badge>}
                      {r.status === 'hidden' && <Badge tone="danger">сховано</Badge>}
                      {r.isMine && <Badge tone="neutral">ваш</Badge>}
                    </div>
                  </div>
                  <p className="mt-0.5 text-[12px] text-graphite-500">{r.summary}</p>
                  <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-graphite-500">
                    <span>⏱ {r.cookingTime} хв</span>
                    <span>· {r.servings} порц.</span>
                    <span>· {DIFFICULTY_LABELS[r.difficulty]}</span>
                    <span>· {MEAL_LABELS[r.mealType]}</span>
                  </div>
                </div>
              </div>

              {r.declaredAllergens.length > 0 && (
                <div className="mt-2 rounded-2xl bg-warn-50 p-2.5 text-[12px] text-[#8a6200]">
                  Автор вказав алергени: {r.declaredAllergens.join(', ')}
                </div>
              )}

              {!r.compositionVerified && (
                <div className="mt-2 rounded-2xl bg-cream-100 p-2.5 text-[11px] leading-relaxed text-graphite-500">
                  ⓘ Склад розпізнано не повністю ({r.unknownIngredients.join(', ')}). Агент не
                  враховує цей рецепт у підборі страв і не може звірити його з вашими
                  харчовими обмеженнями — перевіряйте склад самостійно.
                </div>
              )}

              {/* Вердикт автоперевірки бачить лише автор: це підказка, що виправити,
                  а не публічна оцінка рецепта */}
              {r.moderationIssues.map((issue) => (
                <div
                  key={issue.code}
                  className={`mt-2 rounded-2xl p-2.5 text-[12px] leading-relaxed ${
                    issue.severity === 'block' ? 'bg-danger-50 text-danger-700' : 'bg-cream-100 text-graphite-500'
                  }`}
                >
                  {issue.severity === 'block' ? '⚠ ' : 'ⓘ '}
                  {issue.message}
                </div>
              ))}

              {r.status === 'hidden' && r.isMine && (
                <div className="mt-2 rounded-2xl bg-danger-50 p-2.5 text-[12px] leading-relaxed text-danger-700">
                  Рецепт прибрано зі стрічки за скаргами читачів ({r.reports}). Виправте його або
                  напишіть нам, якщо вважаєте це помилкою.
                </div>
              )}

              {r.status === 'published' && (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[12px] text-graphite-500">
                    {r.votesThisWeek} {pluralize(r.votesThisWeek, 'голос', 'голоси', 'голосів')} цього тижня
                    {r.votesTotal > r.votesThisWeek && ` · ${r.votesTotal} усього`}
                    {!r.isMine && !r.cookedByMe && (
                      <span className="block text-[11px] text-graphite-300">
                        голосувати може той, хто готував
                      </span>
                    )}
                  </span>
                  {/**
                   * Три стани, і жоден не бреше. Кнопка «Голосувати» на
                   * неприготованому рецепті вела б у помилку сервера, тому
                   * замість неї — посилання на сам рецепт: єдиний шлях
                   * заробити голос.
                   */}
                  {r.isMine ? (
                    <span className="shrink-0 text-[12px] text-graphite-300">свій рецепт</span>
                  ) : r.cookedByMe ? (
                    <Button
                      variant={r.votedByMe ? 'primary' : 'secondary'}
                      className="min-h-[44px] px-4 text-[13px]"
                      disabled={vote.isPending}
                      onClick={() => vote.mutate(r.id)}
                    >
                      {r.votedByMe ? '★ Проголосовано' : '☆ Голосувати'}
                    </Button>
                  ) : (
                    <LinkButton
                      href={`/recipes/community/${r.slug}`}
                      variant="secondary"
                      className="min-h-[44px] shrink-0 px-4 text-[13px]"
                    >
                      Приготувати →
                    </LinkButton>
                  )}
                </div>
              )}

              {/* Скарга — друга половина модерації: автоперевірка не бачить
                  небезпечної поради, а читач бачить. Кнопка навмисно дрібна:
                  це не рівноцінна дія з голосуванням */}
              {r.status === 'published' && !r.isMine && (
                reportingId === r.id ? (
                  <div className="mt-2 rounded-2xl bg-cream-100 p-2.5">
                    <p className="text-[12px] text-graphite-700">Що не так із рецептом?</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {REPORT_REASONS.map((reason) => (
                        <button
                          key={reason.value}
                          type="button"
                          className="min-h-[36px] rounded-full bg-white px-3 text-[12px] text-graphite-700"
                          disabled={report.isPending}
                          onClick={() => report.mutate({ recipeId: r.id, reason: reason.value })}
                        >
                          {reason.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="min-h-[36px] px-3 text-[12px] text-graphite-500"
                        onClick={() => setReportingId(null)}
                      >
                        Скасувати
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-2 min-h-[36px] text-[11px] text-graphite-300 underline"
                    onClick={() => setReportingId(r.id)}
                  >
                    Поскаржитись
                  </button>
                )
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
