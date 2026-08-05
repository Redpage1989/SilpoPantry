'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@/components/ui'

export function LoginActions({ mcpUrl }: { mcpUrl: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'demo' | 'silpo' | null>(null)

  async function startDemo() {
    setBusy('demo')
    try {
      const res = await fetch('/api/auth/demo', { method: 'POST' })
      if (!res.ok) throw new Error('Не вдалося запустити демо-режим')
      router.push('/')
      router.refresh()
    } catch {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <Button
        full
        onClick={() => {
          setBusy('silpo')
          window.location.href = '/api/auth/silpo/start'
        }}
        disabled={busy !== null}
      >
        {busy === 'silpo' ? 'Відкриваю «Сільпо»…' : 'Увійти через «Сільпо»'}
      </Button>

      <Button full variant="secondary" onClick={startDemo} disabled={busy !== null}>
        {busy === 'demo' ? 'Готую демо…' : 'Спробувати в демонстраційному режимі'}
      </Button>

      <Card className="bg-cream-50 py-3">
        <p className="text-[11px] leading-relaxed text-graphite-500">
          Вхід відбувається за OAuth 2.1 (Authorization Code + PKCE) на офіційному сервері{' '}
          <span className="font-mono text-[10px] text-graphite-700">{mcpUrl}</span>. Застосунок
          реєструється динамічно — у репозиторії немає жодного client_id чи секрету.
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-graphite-500">
          У демонстраційному режимі використовуються вигадані seed-дані. Вони позначені бейджем{' '}
          <span className="font-semibold">DEMO MODE</span> і ніколи не видаються за реальні.
        </p>
      </Card>
    </div>
  )
}
