import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { hasVisionKey, config } from '@/lib/config'
import { Badge, Card } from '@/components/ui'
import { ScanFlow } from './ScanFlow'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Сканування</h1>
          <p className="text-[13px] text-graphite-500">Сфотографуйте холодильник, полицю або упаковку</p>
        </div>
        {hasVisionKey() ? (
          <Badge tone="success">AI: {config.anthropic.visionModel}</Badge>
        ) : (
          <Badge tone="warn">AI: demo-аналізатор</Badge>
        )}
      </header>

      <Card className="mb-4 bg-cream-50">
        <p className="text-[12px] leading-relaxed text-graphite-500">
          Фото обробляється на сервері й не зберігається на диску. Метадані, зокрема GPS-координати,
          видаляються до аналізу. Результат розпізнавання ніколи не потрапляє в комору автоматично —
          спочатку ви його підтверджуєте.
        </p>
      </Card>

      <ScanFlow />
    </main>
  )
}
