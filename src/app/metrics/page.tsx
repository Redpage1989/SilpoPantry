import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { MetricsBoard } from './MetricsBoard'

export const dynamic = 'force-dynamic'

/**
 * «Що змінилось» — метрики, які пітч називає вголос.
 *
 * Окремий екран, а не блок у коморі: у комори своя робота — показати, що
 * лежить на полиці. Числа про поведінку за тижні читаються інакше й
 * заслуговують місця, де їх можна показати журі одним посиланням.
 */
export default async function MetricsPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  return (
    <main className="mx-auto w-full max-w-md px-4 pb-28 pt-6">
      <header className="mb-4">
        <h1 className="text-[22px] font-semibold tracking-tight text-graphite-900">Що змінилось</h1>
        <p className="mt-1 text-[13px] leading-snug text-graphite-500">
          Чотири числа, за якими видно, працює агент чи ні. Рахуються з ваших подій —
          не з середніх по ринку.
        </p>
      </header>

      <MetricsBoard />

      <p className="mt-4 text-[11px] leading-relaxed text-graphite-300">
        Поки подій замало, картка каже про це прямо, а не показує нуль. Відсоток із двох
        випадків — не метрика, і видавати його за результат ми не будемо.{' '}
        <Link href="/pantry" className="underline">
          До комори
        </Link>
      </p>
    </main>
  )
}
