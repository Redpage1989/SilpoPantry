import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ReactNode, ButtonHTMLAttributes } from 'react'
import Link from 'next/link'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Власна легка UI-система замість shadcn/ui.
 * Причина: усього ~10 примітивів, а повний shadcn тягне генератори й
 * radix-залежності, які тут нічим не окупляться.
 */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-card)] bg-white shadow-[0_2px_14px_rgba(34,31,28,0.06)]',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
      <h2 className="text-[17px] font-semibold tracking-tight text-graphite-900">{children}</h2>
      {action}
    </div>
  )
}

type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warn' | 'success' | 'info'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-cream-200 text-graphite-700',
  accent: 'bg-accent-100 text-accent-700',
  danger: 'bg-danger-50 text-danger-700',
  warn: 'bg-warn-50 text-[#8a6200]',
  success: 'bg-success-50 text-[#1f6b3a]',
  info: 'bg-info-50 text-[#2b529e]',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium leading-none',
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent-500 text-white active:bg-accent-600 disabled:bg-accent-300',
  secondary: 'bg-cream-200 text-graphite-900 active:bg-cream-300',
  ghost: 'bg-transparent text-graphite-700 active:bg-cream-200',
  danger: 'bg-danger-50 text-danger-700 active:bg-[#ffe2df]',
}

export function Button({
  children,
  variant = 'primary',
  full,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; full?: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        // великі кнопки: мінімум 48px висоти для зручності однією рукою
        'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition-colors disabled:opacity-60',
        buttonVariants[variant],
        full && 'w-full',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function LinkButton({
  href,
  children,
  variant = 'primary',
  full,
  className,
}: {
  href: string
  children: ReactNode
  variant?: ButtonVariant
  full?: boolean
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold transition-colors',
        buttonVariants[variant],
        full && 'w-full',
        className,
      )}
    >
      {children}
    </Link>
  )
}

/**
 * Бейдж режиму. Найважливіший елемент чесності інтерфейсу:
 * користувач завжди бачить, це живі дані «Сільпо» чи демонстраційні.
 */
export function ModeBadge({ mode, reason }: { mode: 'live' | 'mock'; reason?: string }) {
  if (mode === 'live') {
    return (
      <Badge tone="success" className="font-semibold">
        <span aria-hidden>●</span> LIVE MCP
      </Badge>
    )
  }
  return (
    <span title={reason} className="inline-flex">
      <Badge tone="warn" className="font-semibold">
        <span aria-hidden>◐</span> DEMO MODE
      </Badge>
    </span>
  )
}

/** Місце під офіційні логотипи «Сільпо», які додасть власник проєкту. */
export function BrandSlot({ label = 'Місце для офіційного логотипа «Сільпо»' }: { label?: string }) {
  return (
    <div
      aria-label={label}
      className="flex h-9 items-center justify-center rounded-xl border border-dashed border-accent-300 px-3 text-[11px] text-accent-700"
    >
      {label}
    </div>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="flex-1">
      <div className="text-[12px] text-graphite-500">{label}</div>
      <div className="text-[19px] font-semibold text-graphite-900">{value}</div>
      {hint && <div className="text-[11px] text-graphite-300">{hint}</div>}
    </div>
  )
}

export function EmptyState({ emoji, title, description, action }: { emoji: string; title: string; description: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-3 py-10 text-center">
      <div className="text-4xl" aria-hidden>
        {emoji}
      </div>
      <div>
        <div className="text-[16px] font-semibold text-graphite-900">{title}</div>
        <p className="mt-1 text-[13px] text-graphite-500">{description}</p>
      </div>
      {action}
    </Card>
  )
}

export function Progress({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'success' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-cream-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn('h-full rounded-full transition-all', tone === 'accent' ? 'bg-accent-500' : 'bg-success-500')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export function Divider() {
  return <div className="my-3 h-px bg-cream-200" />
}

/** Попередження про алергію — навмисно помітне і не згортається. */
export function AllergyWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-2xl border border-danger-500/25 bg-danger-50 p-3 text-[13px] text-danger-700">
      <span aria-hidden className="text-base leading-none">
        ⚠️
      </span>
      <div>{children}</div>
    </div>
  )
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-info-50 p-3 text-[12px] leading-relaxed text-[#2b529e]">{children}</div>
  )
}
