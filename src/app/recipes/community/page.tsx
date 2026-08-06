import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { CommunityFeed } from './CommunityFeed'

export const dynamic = 'force-dynamic'

export default async function CommunityPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-tight">Рецепти спільноти</h1>
        <p className="text-[13px] text-graphite-500">
          Страви від інших родин. Голосуйте за найкращий рецепт тижня.
        </p>
      </header>

      <CommunityFeed />
    </main>
  )
}
