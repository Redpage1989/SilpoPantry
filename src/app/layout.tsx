import type { Metadata, Viewport } from 'next'
import './globals.css'
import { BottomNav } from '@/components/BottomNav'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Сільпо: Сімейна комора',
  description:
    'AI-агент, який знає, що є вдома, планує сімейний раціон і формує готовий кошик «Сільпо». Прототип для хакатону AI Factory.',
  applicationName: 'Сімейна комора',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Сімейна комора' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#f57c1f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <Providers>
          <div className="min-h-[100dvh]">{children}</div>
          <BottomNav />
        </Providers>
      </body>
    </html>
  )
}
