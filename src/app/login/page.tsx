import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { config } from '@/lib/config'
import { Card, Badge, Wordmark } from '@/components/ui'
import { LoginActions } from './LoginActions'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const userId = await getUserId()
  if (userId) redirect('/')
  const { error } = await searchParams

  return (
    <main className="safe-top min-h-[100dvh] px-4 pb-8 pt-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Wordmark />
        <Badge tone="accent">Hackathon prototype</Badge>
      </div>

      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-[28px] bg-accent-500 text-4xl shadow-lg">
          🧺
        </div>
        <h1 className="text-[26px] font-bold leading-tight tracking-tight text-graphite-900">
          Сільпо: Сімейна комора
        </h1>
        <p className="mx-auto mt-2 max-w-[300px] text-[14px] leading-relaxed text-graphite-500">
          AI-агент, який знає, що є вдома, планує меню для всієї родини й формує готовий кошик.
        </p>
      </div>

      {error && (
        <Card className="mb-4 border border-danger-500/20 bg-danger-50">
          <div className="text-[13px] font-medium text-danger-700">Не вдалося увійти</div>
          <p className="mt-1 text-[12px] text-danger-700/80">{error}</p>
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="mb-3 text-[15px] font-semibold">Які дані використовує застосунок</h2>
        <ul className="space-y-2.5 text-[13px] leading-relaxed text-graphite-700">
          <DataRow icon="👨‍👩‍👦" title="Склад родини та харчові обмеження">
            щоб не пропонувати страву з алергеном і врахувати смаки дітей
          </DataRow>
          <DataRow icon="🧾" title="Історія покупок і чеків">
            щоб комора наповнилася сама, без ручного введення
          </DataRow>
          <DataRow icon="🏷️" title="Персональні акції, купони, балабонуси">
            щоб показати вигоду до того, як ви оформите замовлення
          </DataRow>
          <DataRow icon="🛒" title="Кошик">
            щоб додати відсутні інгредієнти — <strong>лише після вашого підтвердження</strong>
          </DataRow>
        </ul>
        <p className="mt-3 rounded-2xl bg-cream-100 p-3 text-[12px] leading-relaxed text-graphite-500">
          Токени доступу зберігаються тільки на сервері й ніколи не потрапляють у браузер. Фото
          обробляються без збереження файлів, метадані (зокрема GPS) видаляються до аналізу.
        </p>
      </Card>

      <LoginActions mcpUrl={config.silpo.mcpUrl} />

      <p className="mt-6 text-center text-[11px] leading-relaxed text-graphite-300">
        Прототип для хакатону «Сільпо» AI Factory. Не є офіційним продуктом ТОВ «Сільпо».
        Демонстраційні дані вигадані.
      </p>
    </main>
  )
}

function DataRow({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="text-lg leading-none">
        {icon}
      </span>
      <span>
        <span className="font-medium text-graphite-900">{title}</span> — {children}
      </span>
    </li>
  )
}
