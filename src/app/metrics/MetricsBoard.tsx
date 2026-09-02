'use client'

import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui'
import { apiGet } from '@/lib/client'
import type { MetricCard } from '@/lib/domain/metrics'

interface MetricsResponse {
  metrics: MetricCard[]
  daysObserved: number
}

export function MetricsBoard() {
  const q = useQuery({
    queryKey: ['metrics'],
    queryFn: () => apiGet<MetricsResponse>('/api/metrics'),
  })

  if (q.isLoading) {
    return (
      <Card>
        <p className="text-[13px] text-graphite-500">Рахую…</p>
      </Card>
    )
  }
  if (!q.data) {
    return (
      <Card>
        <p className="text-[13px] text-danger-700">Не вдалося порахувати метрики.</p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {q.data.metrics.map((m) => (
        <Card key={m.key}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[14px] font-medium leading-snug text-graphite-700">{m.label}</h2>
            {/* Число або прочерк. Прочерк — це теж відповідь: він каже, що
                метрика існує, але даних для неї ще немає */}
            <span
              className={
                m.enough
                  ? 'shrink-0 text-[26px] font-semibold leading-none text-graphite-900'
                  : 'shrink-0 text-[26px] font-semibold leading-none text-cream-300'
              }
            >
              {m.value ?? '—'}
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-graphite-500">{m.hint}</p>
        </Card>
      ))}

      <p className="px-1 text-[11px] text-graphite-300">
        Днів користування: {q.data.daysObserved}
      </p>
    </div>
  )
}
