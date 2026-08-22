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
  /** ваговий товар: quantity в кілограмах, крок — step */
  weighted?: boolean
  step?: number
}

/**
 * Рядки кошика з керуванням кількістю.
 *
 * Два уроки з рев'ю вшиті в цю реалізацію.
 *
 * Кількість живе в ЛОКАЛЬНОМУ стані й оновлюється з відповіді сервера, а не
 * з пропів через router.refresh(). Раніше два швидкі тапи «+» обидва рахували
 * нову кількість від того самого застарілого пропа й надсилали однакове
 * абсолютне значення — у кошику ставало +1 замість +2.
 *
 * Відповідь сервера несе режим адаптера. Якщо сторінку рендерив живий кошик,
 * а тап обробив demo (сесія «Сільпо» протухла між рендером і натисканням) —
 * людині кажуть про це прямо, замість мовчки підмінити екран тіньовим кошиком.
 */
export function CartLines({ lines: initialLines, mode }: { lines: Line[]; mode: 'live' | 'mock' }) {
  const router = useRouter()
  const [lines, setLines] = useState(initialLines)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function change(line: Line, quantity: number) {
    setBusy(line.productId)
    setError(null)
    try {
      const resp = await apiPost<{ cart: { lines: Line[] }; mode: 'live' | 'mock' }>('/api/cart/update', {
        productId: line.productId,
        quantity: Math.max(0, Number(quantity.toFixed(3))),
      })
      if (resp.mode !== mode) {
        setError(
          mode === 'live'
            ? 'Сесія «Сільпо» завершилась — кошик «Сільпо» НЕ змінено. Увійдіть знову на екрані «Як працює агент».'
            : 'Режим застосунку змінився — оновіть сторінку.',
        )
        return
      }
      setLines(resp.cart.lines)
      // підсумки й доставка рендеряться сервером — оновлюємо і їх
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося змінити кошик')
      router.refresh()
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
            /**
             * Для вагового товару крок — його власний addToBasketStep у кг;
             * якщо його раптом немає, 0.1 кг — найменший крок, зустрінутий
             * у живому каталозі: помилитись у менший бік безпечніше.
             */
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
                          {formatUah(Math.round(line.promoPrice * line.quantity))}
                        </div>
                        <div className="text-[11px] text-graphite-300 line-through">
                          {formatUah(Math.round(line.price * line.quantity))}
                        </div>
                      </>
                    ) : (
                      <div className="text-[15px] font-bold">
                        {formatUah(Math.round(line.price * line.quantity))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label={`Зменшити кількість: ${line.name}`}
                    disabled={disabled}
                    onClick={() => change(line, line.quantity - stepSize)}
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
                    onClick={() => change(line, line.quantity + stepSize)}
                    className="flex h-11 w-11 items-center justify-center rounded-xl bg-cream-200 text-[18px] font-semibold text-graphite-900 active:bg-cream-300 disabled:opacity-50"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    aria-label={`Прибрати з кошика: ${line.name}`}
                    disabled={disabled}
                    onClick={() => change(line, 0)}
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
