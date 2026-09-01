'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'
import { FULFILLMENTS, FULFILLMENT_LABELS, type Fulfillment } from '@/lib/domain/fulfillment'

/**
 * Перемикач способу отримання.
 *
 * Чип перемикається оптимістично, а суми ні: вартість доставки й «разом»
 * рендеряться сервером і доїжджають через router.refresh() — той самий
 * патерн, що в CartLines. Якщо запит упав, чип повертається назад:
 * показувати обраним спосіб, якого сервер не прийняв, — брехати про кошик.
 */
export function FulfillmentPicker({ current }: { current: Fulfillment }) {
  const router = useRouter()
  const [value, setValue] = useState<Fulfillment>(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(method: Fulfillment) {
    if (busy || method === value) return
    const previous = value
    setBusy(true)
    setError(null)
    setValue(method)
    try {
      await apiPost('/api/cart/fulfillment', { method })
      router.refresh()
    } catch (err) {
      setValue(previous)
      setError(err instanceof ApiError ? err.message : 'Не вдалося змінити спосіб отримання')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Спосіб отримання" className="grid grid-cols-3 gap-2">
        {FULFILLMENTS.map((method) => {
          const active = method === value
          return (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={busy}
              onClick={() => choose(method)}
              className={cn(
                'min-h-[44px] rounded-xl px-2 py-2 text-[13px] font-medium transition-colors disabled:opacity-60',
                active
                  ? 'bg-accent-500 text-graphite-900'
                  : 'bg-cream-200 text-graphite-700 active:bg-cream-300',
              )}
            >
              {FULFILLMENT_LABELS[method].title}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[12px] text-graphite-500">{FULFILLMENT_LABELS[value].hint}</p>
      {error && <p className="mt-1 text-[12px] text-danger-700">{error}</p>}
    </div>
  )
}
