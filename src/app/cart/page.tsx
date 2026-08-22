import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { runCartOverview } from '@/lib/agent/orchestrator'
import { Badge, Card, LinkButton, ModeBadge, SectionTitle } from '@/components/ui'
import { formatUah, pluralize } from '@/lib/domain/scoring'
import { CartConfirm } from './CartConfirm'
import { CartLines } from './CartLines'

export const dynamic = 'force-dynamic'

export default async function CartPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  /**
   * MCP може віддати транзитний 502 — під час живого прогону це поклало
   * весь екран кошика. Жоден збій зовнішнього сервісу не має призводити
   * до білого екрана: показуємо зрозуміле пояснення і кнопку «Оновити».
   */
  let run: Awaited<ReturnType<typeof runCartOverview>>
  try {
    run = await runCartOverview(userId)
  } catch (err) {
    return <CartUnavailable message={err instanceof Error ? err.message : 'Невідома помилка'} />
  }
  const { cart, loyalty, coupons, slots, pendingProposals, promos } = run.data
  const availableSlots = slots.filter((s) => s.available)

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Кошик</h1>
          <p className="text-[13px] text-graphite-500">
            {cart.lines.length > 0
              ? `${cart.lines.length} ${pluralize(cart.lines.length, 'позиція', 'позиції', 'позицій')}`
              : 'Поки що порожній'}
          </p>
        </div>
        <ModeBadge mode={run.mode} reason={run.modeReason} />
      </header>

      {pendingProposals.length > 0 && (
        <>
          <SectionTitle>Очікують підтвердження</SectionTitle>
          <div className="mb-5 space-y-2">
            {pendingProposals.map((p) => (
              <Card key={p.id} className="border border-accent-300">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-medium">{p.goal}</span>
                  <span className="text-[15px] font-bold">{formatUah(p.total)}</span>
                </div>
                <p className="mt-1 text-[12px] text-graphite-500">
                  {p.lines} товарів · кошик ще не змінено
                </p>
                <CartConfirm proposalId={p.id} />
              </Card>
            ))}
          </div>
        </>
      )}

      {cart.lines.length === 0 ? (
        <Card className="text-center">
          <div className="mb-2 text-4xl" aria-hidden>
            🛒
          </div>
          <h2 className="text-[16px] font-semibold">Кошик порожній</h2>
          <p className="mt-1 text-[13px] text-graphite-500">
            Оберіть страву — агент знайде відсутні інгредієнти в «Сільпо» і збере кошик.
          </p>
          <div className="mt-4">
            <LinkButton href="/recipes" full>
              Підібрати страву
            </LinkButton>
          </div>
        </Card>
      ) : (
        <>
          <CartLines lines={cart.lines} />

          <Card className="mb-4">
            <Row label="Сума" value={formatUah(cart.subtotal)} />
            {cart.discount > 0 && (
              <Row label="Економія за акціями" value={`−${formatUah(cart.discount)}`} tone="success" />
            )}
            <Row label="Доставка" value={cart.deliveryPrice > 0 ? formatUah(cart.deliveryPrice) : 'безкоштовно'} />
            <div className="mt-2 flex items-baseline justify-between border-t border-cream-200 pt-2">
              <span className="text-[15px] font-semibold">Разом</span>
              <span className="text-[20px] font-bold">{formatUah(cart.total)}</span>
            </div>
          </Card>

          {cart.validations.length > 0 && (
            <Card className="mb-4 bg-warn-50">
              <div className="text-[13px] font-medium text-[#8a6200]">Потрібна увага</div>
              <ul className="mt-1 list-disc pl-4 text-[12px] text-[#8a6200]">
                {cart.validations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <SectionTitle>Вигода</SectionTitle>
      <Card className="mb-4">
        {/* Персональні акції переїхали сюди з головної: вигода має лежати
            поруч із сумою, а не серед довідкових блоків на іншому екрані */}
        {promos.length > 0 && (
          <ul className="mb-3 space-y-2.5 border-b border-cream-200 pb-3">
            {promos.slice(0, 4).map((p) => (
              <li key={p.promoId} className="flex gap-2.5 text-[13px]">
                <span aria-hidden>🏷️</span>
                <span className="text-graphite-700">{p.title}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-graphite-700">Балабонуси</span>
          <Badge tone="accent">{loyalty.balabonuses}</Badge>
        </div>
        {coupons.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-cream-200 pt-3">
            {coupons.map((c) => (
              <li key={c.couponId} className="flex items-start gap-2 text-[13px]">
                <span aria-hidden>🎟️</span>
                <div>
                  <div className="font-medium text-graphite-900">{c.title}</div>
                  {c.validUntil && (
                    <div className="text-[11px] text-graphite-500">
                      {/* «до 2026-09-20» — формат бази, а не спосіб, у який люди говорять про дати */}
                      діє до {new Date(c.validUntil).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {availableSlots.length > 0 && (
        <>
          <SectionTitle>Доставка</SectionTitle>
          <Card className="mb-4">
            <ul className="space-y-2">
              {availableSlots.slice(0, 3).map((s) => (
                <li key={s.slotId} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="text-graphite-700">{formatSlot(s.from, s.to)}</span>
                  <span className="font-medium">{formatUah(s.price)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {cart.checkoutUrl && (
        <a
          href={cart.checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-accent-500 text-[16px] font-semibold text-graphite-900 active:bg-accent-600"
        >
          Перейти до оформлення →
        </a>
      )}

      <p className="mt-4 px-1 text-[11px] leading-relaxed text-graphite-300">
        Будь-яка зміна кошика виконується лише після вашого підтвердження. Агент не додає й не
        видаляє товари самостійно.
      </p>
    </main>
  )
}

/** Екран «сервіс тимчасово недоступний» — без технічних подробиць у обличчя. */
function CartUnavailable({ message }: { message: string }) {
  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <h1 className="mb-4 text-[22px] font-bold tracking-tight">Кошик</h1>
      <Card className="text-center">
        <div className="mb-2 text-4xl" aria-hidden>
          🛠️
        </div>
        <h2 className="text-[16px] font-semibold">«Сільпо» тимчасово не відповідає</h2>
        <p className="mt-1 text-[13px] text-graphite-500">
          Кошик не вдалося завантажити. Ваші товари на місці — це збій звʼязку, а не втрата даних.
        </p>
        <p className="mt-2 text-[11px] text-graphite-300">{message}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <LinkButton href="/cart" variant="secondary" full>
            Оновити
          </LinkButton>
          <LinkButton href="/recipes" full>
            До страв
          </LinkButton>
        </div>
      </Card>
    </main>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-[13px] text-graphite-500">{label}</span>
      <span className={`text-[14px] font-medium ${tone === 'success' ? 'text-success-500' : 'text-graphite-900'}`}>
        {value}
      </span>
    </div>
  )
}

function formatSlot(from: string, to: string): string {
  try {
    const f = new Date(from)
    const t = new Date(to)
    const day = f.toLocaleDateString('uk-UA', { day: '2-digit', month: 'short' })
    const time = (d: Date) => d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    return `${day}, ${time(f)}–${time(t)}`
  } catch {
    return `${from} – ${to}`
  }
}
