'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from './ui'

/** Нижня навігація за ТЗ: 5 розділів, велика зона натискання, одна рука. */
const TABS = [
  { href: '/', label: 'Головна', icon: HomeIcon },
  { href: '/pantry', label: 'Комора', icon: PantryIcon },
  { href: '/scan', label: 'Сканувати', icon: ScanIcon, primary: true },
  { href: '/recipes', label: 'Рецепти', icon: RecipeIcon },
  { href: '/cart', label: 'Кошик', icon: CartIcon },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Основна навігація"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] border-t border-cream-200 bg-cream-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href)
          const Icon = tab.icon
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  active ? 'text-accent-700' : 'text-graphite-500',
                )}
              >
                <span
                  className={cn(
                    'flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                    active && 'bg-accent-100',
                    tab.primary && !active && 'bg-accent-700 text-white',
                    tab.primary && active && 'bg-accent-700 text-white',
                  )}
                >
                  <Icon />
                </span>
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    </svg>
  )
}

function PantryIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M5 11h14M9 7v1M9 15v1" strokeLinecap="round" />
    </svg>
  )
}

function ScanIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function RecipeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  )
}

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M4 5h2l1.6 9.2a2 2 0 0 0 2 1.8h6.9a2 2 0 0 0 2-1.6L20 8H7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="19" r="1.4" />
      <circle cx="17" cy="19" r="1.4" />
    </svg>
  )
}
