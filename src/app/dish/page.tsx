import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { DishPlanner } from './DishPlanner'

export const dynamic = 'force-dynamic'

export default async function DishPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; servings?: string }>
}) {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  const { query, servings } = await searchParams

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-tight">Хочу приготувати</h1>
        <p className="text-[13px] text-graphite-500">
          Агент знайде рецепт, перевірить комору й збере кошик із відсутнього
        </p>
      </header>

      <DishPlanner initialQuery={query ?? 'Тірамісу'} initialServings={Number(servings) || undefined} />
    </main>
  )
}
