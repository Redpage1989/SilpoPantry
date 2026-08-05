'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui'
import { apiPost, ApiError } from '@/lib/client'

/**
 * Підтвердження чернетки пропозиції прямо з кошика.
 *
 * confirmationToken живе на сервері: клієнт його не бачить і не може підробити.
 * Тому тут ми звертаємось до окремого маршруту, який звіряє власника пропозиції
 * і лише тоді викликає write-tool MCP.
 */
export function CartConfirm({ proposalId }: { proposalId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/cart/apply', { proposalId })
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося додати до кошика')
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div className="mt-3">
        <Button full variant="secondary" onClick={() => setConfirming(true)}>
          Переглянути й підтвердити
        </Button>
        {error && <div className="mt-2 text-[12px] text-danger-700">{error}</div>}
      </div>
    )
  }

  return (
    <div className="mt-3">
      <div className="rounded-2xl bg-warn-50 p-3 text-[12px] text-[#8a6200]">
        Товари буде додано до вашого кошика «Сільпо». Підтверджуєте?
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
          Ні
        </Button>
        <Button onClick={apply} disabled={busy}>
          {busy ? 'Додаю…' : 'Так, додати'}
        </Button>
      </div>
      {error && <div className="mt-2 text-[12px] text-danger-700">{error}</div>}
    </div>
  )
}
