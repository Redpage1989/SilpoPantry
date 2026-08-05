'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'
import { formatUah } from '@/lib/domain/scoring'

interface DeductionLine {
  itemId: string
  originalName: string
  deducted: number
  unit: string
  remaining: number
  removed: boolean
}

interface CookedResponse {
  plan: DeductionLine[]
  shortfall: { normalizedName: string; missing: number; unit: string }[]
  applied: boolean
}

/**
 * Дії над рецептом: зміна порцій, докупівля, «Я це приготував».
 * Списання інгредієнтів — двоетапне: спочатку показуємо, що буде списано,
 * і лише після другого підтвердження змінюємо комору.
 */
export function RecipeActions({
  slug,
  title,
  servings,
  baseServings,
  missingCount,
  missingCost,
}: {
  slug: string
  title: string
  servings: number
  baseServings: number
  missingCount: number
  missingCost: number
}) {
  const router = useRouter()
  const [preview, setPreview] = useState<CookedResponse | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setServings(next: number) {
    const clamped = Math.max(1, Math.min(12, next))
    router.replace(`/recipes/${slug}?servings=${clamped}`)
  }

  async function cook(apply: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await apiPost<CookedResponse>('/api/cooked', { slug, servings, apply })
      if (apply) {
        setDone(true)
        setPreview(null)
        router.refresh()
      } else {
        setPreview(res)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося виконати')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 space-y-3">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium text-graphite-700">Кількість порцій</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setServings(servings - 1)}
              aria-label="Менше порцій"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-cream-200 text-xl font-semibold active:bg-cream-300"
            >
              −
            </button>
            <span className="w-8 text-center text-[18px] font-bold">{servings}</span>
            <button
              onClick={() => setServings(servings + 1)}
              aria-label="Більше порцій"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-cream-200 text-xl font-semibold active:bg-cream-300"
            >
              +
            </button>
          </div>
        </div>
        {servings !== baseServings && (
          <p className="mt-2 text-[11px] text-graphite-500">
            Кількість інгредієнтів перераховано з базових {baseServings} порц.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-2">
        {missingCount > 0 && (
          <Button
            full
            onClick={() => router.push(`/dish?query=${encodeURIComponent(title)}&servings=${servings}`)}
          >
            Додати відсутнє до кошика · ≈ {formatUah(missingCost)}
          </Button>
        )}
        <Button full variant="secondary" onClick={() => cook(false)} disabled={busy}>
          {busy && !preview ? 'Рахую…' : '✅ Я це приготував'}
        </Button>
      </div>

      {error && <div className="rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>}

      {done && (
        <Card className="bg-success-50">
          <div className="text-[14px] font-semibold text-[#1f6b3a]">Комору оновлено</div>
          <p className="mt-1 text-[12px] text-graphite-700">
            Використані інгредієнти списано. Це і є те, що зменшує харчові відходи: наступного разу
            агент уже знає, чого немає.
          </p>
        </Card>
      )}

      {preview && (
        <Card className="border border-accent-300">
          <div className="text-[14px] font-semibold">Списати ці інгредієнти з комори?</div>
          <ul className="mt-2 divide-y divide-cream-200">
            {preview.plan.map((line) => (
              <li key={line.itemId} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                <span className="min-w-0 truncate">{line.originalName}</span>
                <span className="shrink-0 text-graphite-500">
                  −{line.deducted} {line.unit}
                  {line.removed ? ' · закінчиться' : ` · лишиться ${line.remaining} ${line.unit}`}
                </span>
              </li>
            ))}
            {preview.plan.length === 0 && (
              <li className="py-2 text-[13px] text-graphite-500">Нічого списувати — цих продуктів немає в коморі.</li>
            )}
          </ul>
          {preview.shortfall.length > 0 && (
            <div className="mt-2 rounded-2xl bg-warn-50 p-2.5 text-[12px] text-[#8a6200]">
              Не вистачило: {preview.shortfall.map((s) => `${s.normalizedName} (${s.missing} ${s.unit})`).join(', ')}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Скасувати
            </Button>
            <Button onClick={() => cook(true)} disabled={busy || preview.plan.length === 0}>
              {busy ? 'Списую…' : 'Так, списати'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
