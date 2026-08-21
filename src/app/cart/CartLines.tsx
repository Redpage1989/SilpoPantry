'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'
import { formatUah } from '@/lib/domain/scoring'

interface Line {
  productId: string
  name: string
  quantity: number
  price: number
  promoPrice?: number
  /** ваговий товар: кількість у кілограмах, крок — вага товару */
  weighted?: boolean
  step?: number
}

/**
 * Рядки кошика з керуванням кількістю.
 *
 * До цього кошик був списком без жодного контролю: помилково доданий товар
 * не можна було ні зменшити, ні прибрати, не виходячи в застосунок «Сільпо».
 * Для кошика, який наповнює агент, це найгірше можливе поєднання.
 */
export function CartLines({ lines }: { lines: Line[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function change(productId: string, quantity: number) {
    setBusy(productId)
    setError(null)
    try {
      await apiPost('/api/cart/update', { productId, quantity: Math.max(0, Number(quantity.toFixed(3))) })
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося змінити кошик')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      {error && (
        <div className="mb-3 rounded-2xl bg-danger-50 p-3 text-[13px] text-danger-700">{error}</div>
      )}
      <Card padded={false} className="mb-4 overflow-hidden">
        <ul className="divide-y divide-cream-200">
          {lines.map((line) => {
            // для вагового товару крок — це його власна вага, а не «одна штука»
            const stepSize = line.weighted ? (line.step && line.step > 0 ? line.step : 0.1) : 1
            const unitLabel = line.weighted ? 'кг' : 'шт'
            const disabled = busy === line.productId
            return (
              <li key={line.productId} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium leading-tight">{line.name}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    {line.promoPrice && line.promoPrice < line.price ? (
                      <>
                        <div className="text-[15px] font-bold text-accent-700">
                          {formatUah(line.promoPrice * line.quantity)}
                        </div>
                        <div className="text-[11px] text-graphite-300 line-through">
                          {formatUah(line.price * line.quantity)}
                        </div>
                      </>
                    ) : (
                      <div className="text-[15px] font-bold">{formatUah(line.price * line.quantity)}</div>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Зменшити кількість: ${line.name}`}
                    disabled={disabled}
                    onClick={() => change(line.productId, line.quantity - stepSize)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream-200 text-[18px] font-semibold text-graphite-900 active:bg-cream-300 disabled:opacity-50"
                  >
                    −
                  </button>
                  <span className="min-w-[72px] text-center text-[13px] font-medium tabular-nums">
                    {line.weighted ? line.quantity.toFixed(2).replace('.', ',') : line.quantity} {unitLabel}
                  </span>
                  <button
                    type="button"
                    aria-label={`Збільшити кількість: ${line.name}`}
                    disabled={disabled}
                    onClick={() => change(line.productId, line.quantity + stepSize)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream-200 text-[18px] font-semibold text-graphite-900 active:bg-cream-300 disabled:opacity-50"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    aria-label={`Прибрати з кошика: ${line.name}`}
                    disabled={disabled}
                    onClick={() => change(line.productId, 0)}
                    className="ml-auto inline-flex min-h-[44px] items-center px-2 text-[13px] font-medium text-accent-700 disabled:opacity-50"
                  >
                    {disabled ? 'Змінюю…' : 'Прибрати'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </>
  )
}
