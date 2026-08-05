'use client'

import { useMutation } from '@tanstack/react-query'
import { Badge, Button, Card } from '@/components/ui'
import { apiGet, ApiError } from '@/lib/client'

interface ProbeResponse {
  mode: 'live' | 'mock'
  reason: string
  canGoLive: boolean
  durationMs: number
  count: number
  tools: { name: string; description?: string }[]
}

/**
 * Живий доказ інтеграції: натискання виконує tools/list на
 * https://mcp.silpo.ua/mcp з реальним Bearer-токеном сесії.
 * У demo-режимі повертається емуляція, і це чесно позначено.
 */
export function McpProbe() {
  const probe = useMutation({ mutationFn: () => apiGet<ProbeResponse>('/api/mcp/tools') })

  return (
    <Card className="mb-4">
      <Button full variant="secondary" onClick={() => probe.mutate()} disabled={probe.isPending}>
        {probe.isPending ? 'Викликаю tools/list…' : 'Виконати tools/list на MCP «Сільпо»'}
      </Button>

      {probe.isError && (
        <div className="mt-3 rounded-2xl bg-danger-50 p-3 text-[12px] text-danger-700">
          {probe.error instanceof ApiError ? probe.error.message : 'Помилка виклику'}
        </div>
      )}

      {probe.data && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2">
            <Badge tone={probe.data.mode === 'live' ? 'success' : 'warn'}>
              {probe.data.mode === 'live' ? 'LIVE MCP' : 'DEMO'}
            </Badge>
            <span className="text-[12px] text-graphite-500">
              {probe.data.count} інструментів · {probe.data.durationMs} мс
            </span>
          </div>
          <p className="mt-1.5 text-[12px] text-graphite-500">{probe.data.reason}</p>

          <div className="mt-3 max-h-72 overflow-y-auto rounded-2xl bg-graphite-900 p-3">
            <ul className="space-y-1">
              {probe.data.tools.map((t) => (
                <li key={t.name} className="font-mono text-[11px] leading-relaxed text-cream-200">
                  <span className="text-accent-300">▸</span> {t.name}
                </li>
              ))}
            </ul>
          </div>

          {probe.data.mode === 'mock' && probe.data.canGoLive && (
            <p className="mt-2 text-[11px] text-graphite-500">
              Щоб побачити реальні 39 інструментів «Сільпо» — увійдіть через «Сільпо» вище.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
