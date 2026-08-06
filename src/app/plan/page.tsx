import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { Card } from '@/components/ui'
import { WeekPlanner } from './WeekPlanner'

export const dynamic = 'force-dynamic'

export default async function PlanPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-tight">Раціон на тиждень</h1>
        <p className="text-[13px] text-graphite-500">
          Агент розкладає страви по днях і рахує один спільний список покупок
        </p>
      </header>

      <WeekPlanner />

      <Card className="mt-5 bg-cream-50">
        <div className="text-[13px] font-semibold text-graphite-700">Чому це не просто сім разів «підбери страву»</div>
        <p className="mt-2 text-[12px] leading-relaxed text-graphite-500">
          Плануючи, агент <strong>вичерпує комору</strong>: після кожної страви залишки
          зменшуються, і наступний день рахується вже на тому, що реально лишиться. Тому
          молоко з понеділка не «покриває» ще й четвер, а список покупок на тиждень не
          зараховує ті самі продукти двічі.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-graphite-500">
          Продукти з близьким терміном ставляться в перші дні — далі вони просто зіпсуються.
        </p>
      </Card>
    </main>
  )
}
