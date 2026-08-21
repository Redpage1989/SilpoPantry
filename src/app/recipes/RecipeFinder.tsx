'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { Badge, Button, Card, ModeBadge, Progress } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'
import { formatUah } from '@/lib/domain/scoring'
import { DIFFICULTY_LABELS, MEAL_LABELS, type MealType, type Difficulty } from '@/lib/domain/types'

interface Factor {
  key: string
  label: string
  value: number
  weight: number
  contribution: number
  explanation: string
}

interface Suggestion {
  recipe: {
    id: string
    slug: string
    title: string
    summary: string
    servings: number
    cookingTime: number
    difficulty: Difficulty
    cuisine: string
    imageEmoji: string
    nutrition: { kcal: number }
  }
  score: number
  reason: string
  missingCost: number
  factors: Factor[]
  coverage: {
    coverage: number
    have: { name: string }[]
    missing: { name: string; missing: number; unit: string; optional: boolean }[]
    rescues: string[]
    approxMissingCost: number
  }
  restrictions: { result: string; violations: { message: string }[]; allergyNotice: string | null }
}

interface SuggestResponse {
  mode: 'live' | 'mock'
  modeReason: string
  durationMs: number
  suggestions: Suggestion[]
  plan: { n: number; tool: string; why: string }[]
}

export function RecipeFinder() {
  const [servings, setServings] = useState(2)
  const [mealType, setMealType] = useState<MealType | ''>('dinner')
  const [maxMinutes, setMaxMinutes] = useState(40)
  const [maxBudget, setMaxBudget] = useState(300)
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('')
  const [cuisine, setCuisine] = useState('')
  const [rescueMode, setRescueMode] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<SuggestResponse>('/api/recipes/suggest', {
        servings,
        mealType: mealType || undefined,
        maxMinutes,
        maxBudget: maxBudget * 100,
        difficulty: difficulty || undefined,
        cuisine: cuisine || undefined,
        rescueMode,
      }),
  })

  // одразу показуємо результат, щоб екран не був порожнім
  useEffect(() => {
    mutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const data = mutation.data

  return (
    <div className="space-y-4">
      <Card>
        <div className="space-y-3">
          <Row label={`Кількість людей: ${servings}`}>
            <input
              type="range"
              min={1}
              max={8}
              value={servings}
              onChange={(e) => setServings(Number(e.target.value))}
              className="h-11 w-full accent-[var(--color-accent-500)]"
              aria-label="Кількість людей"
            />
          </Row>

          <Row label="Прийом їжі">
            <div className="flex flex-wrap gap-1.5">
              {(['breakfast', 'lunch', 'dinner', 'dessert', 'snack'] as MealType[]).map((m) => (
                <Chip key={m} active={mealType === m} onClick={() => setMealType(mealType === m ? '' : m)}>
                  {MEAL_LABELS[m]}
                </Chip>
              ))}
            </div>
          </Row>

          <Row label={`Максимальний час: ${maxMinutes} хв`}>
            <input
              type="range"
              min={10}
              max={120}
              step={5}
              value={maxMinutes}
              onChange={(e) => setMaxMinutes(Number(e.target.value))}
              className="h-11 w-full accent-[var(--color-accent-500)]"
              aria-label="Максимальний час"
            />
          </Row>

          <Row label={`Максимальний бюджет докупівлі: ${maxBudget} грн`}>
            <input
              type="range"
              min={0}
              max={1000}
              step={25}
              value={maxBudget}
              onChange={(e) => setMaxBudget(Number(e.target.value))}
              className="h-11 w-full accent-[var(--color-accent-500)]"
              aria-label="Максимальний бюджет"
            />
          </Row>

          <Row label="Складність">
            <div className="flex gap-1.5">
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(difficulty === d ? '' : d)}>
                  {DIFFICULTY_LABELS[d]}
                </Chip>
              ))}
            </div>
          </Row>

          <Row label="Кухня">
            <div className="flex flex-wrap gap-1.5">
              {['Українська', 'Італійська', 'Азійська', 'Середземноморська', 'Американська'].map((c) => (
                <Chip key={c} active={cuisine === c} onClick={() => setCuisine(cuisine === c ? '' : c)}>
                  {c}
                </Chip>
              ))}
            </div>
          </Row>

          <label className="flex items-center gap-3 rounded-2xl bg-cream-100 p-3">
            <input
              type="checkbox"
              checked={rescueMode}
              onChange={(e) => setRescueMode(e.target.checked)}
              className="h-5 w-5 accent-[var(--color-accent-500)]"
            />
            <span className="text-[13px] font-medium text-graphite-700">
              Використати те, що скоро зіпсується
            </span>
          </label>

          <Button full onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Агент працює…' : 'Підібрати страви'}
          </Button>
        </div>
      </Card>

      {mutation.isError && (
        <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Помилка підбору'}
        </div>
      )}

      {data && (
        <>
          {/* h2 між h1 сторінки та h3 карток: без нього зчитувач бачив стрибок рівня */}
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[12px] font-normal text-graphite-500">
              {data.suggestions.length} варіантів · {data.durationMs} мс
            </h2>
            <ModeBadge mode={data.mode} reason={data.modeReason} />
          </div>

          {data.suggestions.length === 0 && (
            <Card>
              <p className="text-[13px] text-graphite-500">
                Під ці умови страв не знайшлося. Спробуйте збільшити час або бюджет.
              </p>
            </Card>
          )}

          {data.suggestions.map((s) => (
            <Card key={s.recipe.id} className="animate-rise">
              <div className="flex gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-cream-200 text-3xl" aria-hidden>
                  {s.recipe.imageEmoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[16px] font-semibold leading-tight">{s.recipe.title}</h3>
                    <Badge tone={s.coverage.missing.length === 0 ? 'success' : 'accent'}>
                      {Math.round(s.coverage.coverage * 100)}%
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-graphite-500">{s.recipe.summary}</p>
                  <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-graphite-500">
                    <span>⏱ {s.recipe.cookingTime} хв</span>
                    <span>· {s.recipe.servings} порц.</span>
                    <span>· {DIFFICULTY_LABELS[s.recipe.difficulty]}</span>
                    <span>· ~{s.recipe.nutrition.kcal} ккал</span>
                    <span>· {s.recipe.cuisine}</span>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <Progress value={s.coverage.coverage} tone={s.coverage.missing.length === 0 ? 'success' : 'accent'} />
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                <div className="rounded-2xl bg-success-50 p-2.5">
                  <div className="font-semibold text-[#1f6b3a]">Уже є ({s.coverage.have.length})</div>
                  <div className="mt-0.5 text-graphite-700">
                    {s.coverage.have.map((h) => h.name).join(', ') || '—'}
                  </div>
                </div>
                <div className="rounded-2xl bg-accent-50 p-2.5">
                  <div className="font-semibold text-accent-700">
                    Докупити ({s.coverage.missing.filter((m) => !m.optional).length})
                  </div>
                  <div className="mt-0.5 text-graphite-700">
                    {s.coverage.missing.filter((m) => !m.optional).map((m) => m.name).join(', ') || '—'}
                  </div>
                  {s.missingCost > 0 && (
                    <div className="mt-1 font-semibold text-accent-700">≈ {formatUah(s.missingCost)}</div>
                  )}
                </div>
              </div>

              <p className="mt-3 text-[13px] leading-snug text-graphite-700">{s.reason}</p>

              {s.restrictions.violations.length > 0 && (
                <div className="mt-2 rounded-2xl bg-warn-50 p-2.5 text-[12px] text-[#8a6200]">
                  {s.restrictions.violations.map((v) => v.message).join('; ')}
                </div>
              )}
              {s.restrictions.allergyNotice && (
                <div className="mt-2 rounded-2xl bg-danger-50 p-2.5 text-[12px] text-danger-700">
                  ⚠️ {s.restrictions.allergyNotice}
                </div>
              )}

              <button
                onClick={() => setExpanded(expanded === s.recipe.id ? null : s.recipe.id)}
                className="mt-1 inline-flex min-h-[44px] items-center text-[13px] font-medium text-accent-700"
              >
                {expanded === s.recipe.id ? 'Сховати розрахунок' : 'Чому саме ця страва?'}
              </button>

              {expanded === s.recipe.id && (
                <div className="mt-2 space-y-1.5 rounded-2xl bg-cream-100 p-3">
                  {s.factors.map((f) => (
                    <div key={f.key} className="text-[12px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-graphite-900">{f.label}</span>
                        <span className="font-mono text-[11px] text-graphite-500">
                          {f.value.toFixed(2)} × {f.weight.toFixed(2)} = {f.contribution.toFixed(3)}
                        </span>
                      </div>
                      <div className="text-graphite-500">{f.explanation}</div>
                    </div>
                  ))}
                  <div className="border-t border-cream-300 pt-1.5 text-[12px] font-semibold">
                    Підсумковий бал: {s.score.toFixed(3)}
                  </div>
                </div>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  href={`/recipes/${s.recipe.slug}?servings=${servings}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-cream-200 text-[14px] font-semibold text-graphite-900"
                >
                  Рецепт
                </Link>
                <Link
                  href={`/dish?query=${encodeURIComponent(s.recipe.title)}&servings=${servings}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-2xl bg-accent-500 text-[14px] font-semibold text-graphite-900"
                >
                  Зібрати кошик
                </Link>
              </div>
            </Card>
          ))}
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-[44px] rounded-full px-3.5 text-[13px] font-medium transition-colors ${
        active ? 'bg-accent-500 text-graphite-900' : 'bg-cream-200 text-graphite-700'
      }`}
    >
      {children}
    </button>
  )
}
