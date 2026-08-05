'use client'

import { useState } from 'react'
import { Badge, Card } from './ui'
import type { TraceStep } from '@/lib/agent/tools'

/**
 * Безпечний трейс агента.
 *
 * Показує послідовність інструментів, реальні назви MCP-tools, схеми,
 * які ми звірили перед викликом, і тривалість. НЕ показує токени,
 * телефони, email, адреси — вони вирізані ще на сервері (lib/mcp/pii.ts).
 */
export function AgentTrace({
  plan,
  trace,
  mode,
}: {
  plan: { n: number; tool: string; why: string }[]
  trace: TraceStep[]
  mode: 'live' | 'mock'
}) {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <Card className="bg-graphite-900 text-cream-100">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Послідовність дій агента</h3>
        <Badge tone={mode === 'live' ? 'success' : 'warn'}>{mode === 'live' ? 'LIVE MCP' : 'DEMO'}</Badge>
      </div>

      <div className="mb-3 rounded-2xl bg-white/5 p-3">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cream-300">План</div>
        <ol className="space-y-1">
          {plan.map((p) => (
            <li key={p.n} className="text-[12px] leading-snug text-cream-200">
              <span className="font-mono text-accent-300">{p.n}.</span>{' '}
              <span className="font-medium">{p.tool}</span>
              <span className="text-cream-300/70"> — {p.why}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2">
        {trace.map((step) => (
          <div key={step.index} className="rounded-2xl bg-white/5">
            <button
              onClick={() => setOpen(open === step.index ? null : step.index)}
              className="flex w-full items-start justify-between gap-2 p-3 text-left"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] ${step.status === 'ok' ? 'text-success-500' : 'text-danger-500'}`}>
                    {step.status === 'ok' ? '●' : '✕'}
                  </span>
                  <span className="font-mono text-[12px] font-medium">{step.tool}</span>
                  <span className="text-[10px] text-cream-300/60">{step.durationMs} мс</span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-cream-200/85">{step.summary}</p>
                {(step.mcpCalls?.length ?? 0) > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {step.mcpCalls!.map((c, i) => (
                      <span
                        key={i}
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                          c.mode === 'live' ? 'bg-success-500/20 text-success-500' : 'bg-warn-500/20 text-warn-500'
                        }`}
                      >
                        {c.tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="shrink-0 text-cream-300/50">{open === step.index ? '▾' : '▸'}</span>
            </button>

            {open === step.index && (
              <div className="border-t border-white/10 p-3 pt-2">
                {step.mcpCalls?.map((call, i) => (
                  <div key={i} className="mb-2 last:mb-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-cream-300/60">
                      MCP · {call.tool}
                    </div>
                    {call.schema && (
                      <div className="mt-1 text-[10px] text-cream-300/70">
                        Схема: обовʼязкові [{call.schema.required.join(', ') || '—'}] · поля [
                        {call.schema.properties.slice(0, 8).join(', ')}]
                      </div>
                    )}
                    <pre className="mt-1 overflow-x-auto rounded-xl bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-cream-200/80">
                      {JSON.stringify({ args: call.args, result: call.resultPreview }, null, 1).slice(0, 900)}
                    </pre>
                  </div>
                ))}
                {(!step.mcpCalls || step.mcpCalls.length === 0) && (
                  <pre className="overflow-x-auto rounded-xl bg-black/30 p-2 font-mono text-[10px] leading-relaxed text-cream-200/80">
                    {JSON.stringify(step.output ?? step.input ?? {}, null, 1).slice(0, 700)}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-cream-300/60">
        Токени доступу, телефони, email, адреси та зайві ідентифікатори маскуються на сервері
        й ніколи не потрапляють у цей трейс.
      </p>
    </Card>
  )
}
