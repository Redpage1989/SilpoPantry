import type { Metadata, Viewport } from 'next'
import './globals.css'
import { BottomNav } from '@/components/BottomNav'
import { Providers } from './providers'

export const metadata: Metadata = {
  /**
   * Без базової адреси Next збирає og:image відносно localhost:3000 — саме
   * так посилання на прод і виглядало в месенджерах: картинки не було.
   * Адреса одна, тож константа; форк на іншому домені міняє її тут.
   */
  metadataBase: new URL('https://komora.im.pl.ua'),
  title: 'Сільпо: Сімейна комора',
  description:
    'AI-агент, який знає, що є вдома, планує сімейний раціон і формує готовий кошик «Сільпо». Прототип для хакатону AI Factory.',
  applicationName: 'Сімейна комора',
  manifest: '/manifest.webmanifest',
  /**
   * Іконки задані явно, бо покривають три різні споживачі: вкладку браузера,
   * «Додати на початковий екран» на iOS (apple-touch-icon — Apple ігнорує
   * маніфест) і посилання, яким застосунок шерять.
   */
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'Сільпо: Сімейна комора',
    description:
      'AI-агент, який знає, що є вдома, планує сімейний раціон і формує готовий кошик «Сільпо».',
    images: ['/icon-512.png'],
    locale: 'uk_UA',
    type: 'website',
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Сімейна комора' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#f57c1f',
  width: 'device-width',
  initialScale: 1,
  /**
   * maximumScale навмисно НЕ задано.
   *
   * Раніше тут стояло `maximumScale: 1`, і це блокувало масштабування
   * жестом — пряме порушення WCAG 1.4.4 (Resize text). Для застосунку,
   * де половина підписів набрана 11–13 px, заборона збільшити текст
   * коштує дорожче за випадковий зум під час прокрутки.
   */
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
