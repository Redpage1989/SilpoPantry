import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { Card, LinkButton } from '@/components/ui'
import { RecipeFinder } from './RecipeFinder'

export const dynamic = 'force-dynamic'

export default async function RecipesPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-tight">Що можна приготувати?</h1>
        <p className="text-[13px] text-graphite-500">
          Агент рахує, що вже є вдома, і сортує страви за прозорими правилами
        </p>
      </header>

      <div className="mb-4">
        <LinkButton href="/plan" variant="secondary" full>
          📅 Одразу спланувати весь тиждень
        </LinkButton>
      </div>

      <RecipeFinder />

      <Card className="mt-5 bg-cream-50">
        <div className="text-[13px] font-semibold text-graphite-700">Як формується рейтинг</div>
        <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-graphite-500">
          <li>1. Мінімальна кількість докупівлі</li>
          <li>2. Продукти з найближчим терміном придатності</li>
          <li>3. Відповідність обмеженням родини (алерген = страва виключається)</li>
          <li>4. Бюджет · 5. Час приготування · 6. Персональні вподобання</li>
        </ul>
      </Card>
    </main>
  )
}
