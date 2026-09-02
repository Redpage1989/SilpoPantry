'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiPost, ApiError } from '@/lib/client'

/**
 * «Викинув» на позиції комори.
 *
 * Дія навмисно дрібна й з підтвердженням: це не щоденний сценарій, а
 * зізнання, яке людині неприємно робити. Але без нього метрика втрат не має
 * знаменника — комора вміла списати з'їдене й не вміла записати викинуте,
 * тобто продукт, що продає «менше викидати», не міг цього порахувати.
 */
export function WasteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    try {
      await apiPost('/api/pantry/waste', { id })
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося записати')
      setBusy(false)
      setAsking(false)
    }
  }

  if (error) return <span className="text-[11px] text-danger-700">{error}</span>

  if (!asking) {
    return (
      <button
        type="button"
        className="min-h-[32px] text-[11px] text-graphite-300 underline underline-offset-2"
        onClick={() => setAsking(true)}
      >
        Викинув
      </button>
    )
  }

  return (
    <span className="flex items-center gap-2 text-[11px]">
      <span className="text-graphite-500">Викинути «{name}»?</span>
      <button
        type="button"
        className="min-h-[32px] rounded-full bg-danger-50 px-2.5 text-danger-700"
        disabled={busy}
        onClick={confirm}
      >
        {busy ? 'Записую…' : 'Так'}
      </button>
      <button
        type="button"
        className="min-h-[32px] px-1 text-graphite-300"
        onClick={() => setAsking(false)}
      >
        Ні
      </button>
    </span>
  )
}
