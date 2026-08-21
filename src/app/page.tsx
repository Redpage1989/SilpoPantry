import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { runDashboard } from '@/lib/agent/orchestrator'
import { Badge, BrandSlot, Card, LinkButton, ModeBadge, Progress, SectionTitle, Stat } from '@/components/ui'
import { formatUah, pluralize } from '@/lib/domain/scoring'
import { expiryStatus, daysUntil } from '@/lib/domain/pantry'
import { displayName } from '@/lib/domain/normalize'
import { formatQuantity } from '@/lib/domain/units'
import { DishRequestBar } from '@/components/DishRequestBar'

export const dynamic = 'force-dynamic'

function DashboardUnavailable({ message }: { message: string }) {
  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight">Сімейна комора</h1>
      <Card className="text-center">
        <div className="mb-2 text-4xl" aria-hidden>
          🛠️
        </div>
        <h2 className="text-[16px] font-semibold">«Сільпо» тимчасово не відповідає</h2>
        <p className="mt-1 text-[13px] text-graphite-500">
          Це збій звʼязку із сервісом, а не втрата ваших даних. Спробуйте оновити сторінку.
        </p>
        <p className="mt-2 text-[11px] text-graphite-300">{message}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <LinkButton href="/" variant="secondary" full>
            Оновити
          </LinkButton>
          <LinkButton href="/pantry" full>
            До комори
          </LinkButton>
        </div>
      </Card>
    </main>
  )
}

export default async function HomePage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  // Головна також не має падати через збій MCP — див. коментар у /cart
  let run: Awaited<ReturnType<typeof runDashboard>>
  try {
    run = await runDashboard(userId)
  } catch (err) {
    return <DashboardUnavailable message={err instanceof Error ? err.message : 'Невідома помилка'} />
  }
  const { household, pantry, expiring, suggestions, daysOfFood, cart, promos, loyalty, restock } = run.data
  const now = new Date()

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <div className="text-[12px] text-graphite-500">Вітаємо,</div>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">{household.displayName}</h1>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <ModeBadge mode={run.mode} reason={run.modeReason} />
          <Badge tone="accent">Hackathon prototype</Badge>
        </div>
      </header>

      <div className="mb-4">
        <BrandSlot />
      </div>

      {/* Швидкі дії — найбільші кнопки на екрані */}
      <div className="mb-5 grid grid-cols-2 gap-3">
        <Link
          href="/scan"
          className="flex min-h-[92px] flex-col justify-between rounded-[var(--radius-card)] bg-accent-500 p-4 text-graphite-900 active:bg-accent-600"
        >
          <span className="text-2xl" aria-hidden>
            📸
          </span>
          <span className="text-[14px] font-semibold leading-tight">Сфотографувати холодильник</span>
        </Link>
        <Link
          href="/plan"
          className="flex min-h-[92px] flex-col justify-between rounded-[var(--radius-card)] bg-white p-4 shadow-[0_2px_14px_rgba(34,31,28,0.06)] active:bg-cream-100"
        >
          <span className="text-2xl" aria-hidden>
            📅
          </span>
          <span className="text-[14px] font-semibold leading-tight text-graphite-900">
            Спланувати тиждень
          </span>
        </Link>
      </div>

      <div className="mb-5">
        <DishRequestBar />
      </div>

      {/* Порожня комора — головна причина, чому новий користувач бачить
          порожній екран і не розуміє, що робити далі. Підказка з дією. */}
      {pantry.length === 0 && (
        <Card className="mb-5 border border-accent-300">
          <div className="flex gap-3">
            <span className="text-2xl" aria-hidden>
              🧺
            </span>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold leading-tight">Комора ще порожня</h2>
              <p className="mt-1 text-[13px] leading-snug text-graphite-500">
                Найшвидший спосіб — підтягнути ваші покупки з «Сільпо». Агент сам оцінить,
                що ще лишилось удома, і почне пропонувати страви.
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <LinkButton href="/pantry" full>
              🧾 Імпорт із чеків
            </LinkButton>
            <LinkButton href="/scan" variant="secondary" full>
              📸 Сфотографувати
            </LinkButton>
          </div>
        </Card>
      )}

      {/* Що приготуємо сьогодні */}
      <SectionTitle action={<Link href="/recipes" className="-my-2 inline-flex min-h-[44px] items-center px-1 text-[13px] font-medium text-accent-700">Усі страви</Link>}>
        Що приготуємо сьогодні?
      </SectionTitle>
      <div className="mb-5 space-y-3">
        {suggestions.length === 0 && (
          <Card>
            <p className="text-[13px] text-graphite-500">
              Поки що недостатньо даних. Додайте продукти через сканування або імпортуйте чеки «Сільпо».
            </p>
          </Card>
        )}
        {suggestions.map((s) => (
          <Link key={s.recipe.id} href={`/recipes/${s.recipe.slug}`} className="block">
            <Card className="animate-rise">
              <div className="flex gap-3">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cream-200 text-2xl" aria-hidden>
                  {s.recipe.imageEmoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold leading-tight">{s.recipe.title}</h3>
                    <Badge tone={s.coverage.missing.length === 0 ? 'success' : 'accent'}>
                      {Math.round(s.coverage.coverage * 100)}%
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-graphite-500">
                    <span>⏱ {s.recipe.cookingTime} хв</span>
                    <span>·</span>
                    <span>{s.recipe.servings} порц.</span>
                    <span>·</span>
                    <span>~{s.recipe.nutrition.kcal} ккал</span>
                    {s.coverage.missing.length > 0 && (
                      <span className="text-accent-700">· докупити ≈ {formatUah(s.missingCost)}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    <Progress value={s.coverage.coverage} tone={s.coverage.missing.length === 0 ? 'success' : 'accent'} />
                  </div>
                  <p className="mt-2 text-[12px] leading-snug text-graphite-500">{s.reason}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Продукти, які треба використати */}
      <SectionTitle action={<Link href="/pantry" className="-my-2 inline-flex min-h-[44px] items-center px-1 text-[13px] font-medium text-accent-700">Комора</Link>}>
        {expiring.length > 0
          ? `${expiring.length} ${pluralize(expiring.length, 'продукт', 'продукти', 'продуктів')} потрібно використати найближчим часом`
          : 'Терміни придатності під контролем'}
      </SectionTitle>
      <Card className="mb-5">
        {expiring.length === 0 ? (
          <p className="text-[13px] text-graphite-500">
            Продуктів із близьким терміном придатності немає. Так тримати — це і є менше харчових відходів.
          </p>
        ) : (
          <ul className="divide-y divide-cream-200">
            {expiring.map((item) => {
              const status = expiryStatus(item.expiryDate, now)
              const days = item.expiryDate ? daysUntil(item.expiryDate, now) : null
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">{displayName(item.originalName)}</div>
                    <div className="text-[11px] text-graphite-500">
                      {formatQuantity(item.quantity, item.unit)} · {item.category}
                    </div>
                  </div>
                  <Badge tone={status === 'use_today' || status === 'expired' ? 'danger' : 'warn'}>
                    {status === 'expired'
                      ? 'Термін минув'
                      : days === 0
                        ? 'Сьогодні'
                        : days === 1
                          ? 'До завтра'
                          : `${days} дн.`}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Показники */}
      <Card className="mb-5">
        <div className="flex gap-3">
          <Stat
            label="Вистачить продуктів"
            /**
             * Округлення до цілого і форма слова мають узгоджуватись між собою.
             * Було «≈ 0.5 день»: крапка замість коми, і Math.round(0.5) = 1
             * давало однину до дробового числа.
             */
            value={
              daysOfFood < 1
                ? 'менше дня'
                : `≈ ${Math.round(daysOfFood)} ${pluralize(Math.round(daysOfFood), 'день', 'дні', 'днів')}`
            }
            hint={`на ${household.members.length} ос.`}
          />
          <div className="w-px bg-cream-200" />
          <Stat
            label="Бюджет на тиждень"
            value={household.weeklyBudget ? formatUah(household.weeklyBudget) : '—'}
            hint={cart.total > 0 ? `у кошику ${formatUah(cart.total)}` : 'кошик порожній'}
          />
        </div>
      </Card>

      {/* Докупити */}
      {restock.length > 0 && (
        <>
          <SectionTitle>Товари, які варто докупити</SectionTitle>
          <Card className="mb-5">
            <ul className="space-y-2">
              {restock.map((r) => (
                <li key={r.name} className="flex items-baseline justify-between gap-3">
                  <span className="text-[14px] font-medium">{displayName(r.name)}</span>
                  <span className="text-right text-[11px] text-graphite-500">{r.reason}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {/* Персональні пропозиції */}
      <SectionTitle>Персональні пропозиції «Сільпо»</SectionTitle>
      <Card className="mb-5">
        {promos.length === 0 ? (
          <p className="text-[13px] text-graphite-500">Персональних акцій зараз немає.</p>
        ) : (
          <ul className="space-y-2.5">
            {promos.slice(0, 4).map((p) => (
              <li key={p.promoId} className="flex gap-2.5 text-[13px]">
                <span aria-hidden>🏷️</span>
                <span className="text-graphite-700">{p.title}</span>
              </li>
            ))}
          </ul>
        )}
        {loyalty.balabonuses > 0 && (
          <div className="mt-3 rounded-2xl bg-accent-50 p-3 text-[13px] text-accent-700">
            Доступно балабонусів: <strong>{loyalty.balabonuses}</strong>
            {loyalty.level ? ` · ${loyalty.level}` : ''}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <LinkButton href="/plan" variant="secondary" full>
          Раціон на тиждень
        </LinkButton>
        <LinkButton href="/trace" variant="secondary" full>
          Як працює агент
        </LinkButton>
      </div>
    </main>
  )
}
