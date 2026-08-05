import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { prisma } from '@/lib/db'
import { config } from '@/lib/config'
import { Badge, Card, LinkButton, SectionTitle } from '@/components/ui'
import { McpProbe } from './McpProbe'

export const dynamic = 'force-dynamic'

/**
 * Технічний екран для журі: як влаштований агент, які інструменти він має
 * і живий доказ інтеграції з MCP «Сільпо» (tools/list на реальному сервері).
 */
export default async function TracePage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  const [runs, session] = await Promise.all([
    prisma.agentRun.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.mcpSession.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } }),
  ])

  const authorized = !!session && session.expiresAt > new Date()

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-tight">Як працює агент</h1>
        <p className="text-[13px] text-graphite-500">
          Технічний розріз для журі: інструменти, план і живий MCP-виклик
        </p>
      </header>

      <SectionTitle>Стан підключення</SectionTitle>
      <Card className="mb-4">
        <div className="space-y-2 text-[13px]">
          <Row label="MCP endpoint" value={config.silpo.mcpUrl} mono />
          <Row label="Режим" value={config.silpo.mode} mono />
          <Row
            label="Авторизація"
            value={authorized ? 'активна (OAuth 2.1 + PKCE)' : 'немає — працює demo mode'}
          />
          {session && (
            <Row
              label="Токен дійсний до"
              value={session.expiresAt.toLocaleString('uk-UA')}
            />
          )}
        </div>
        {!authorized && (
          <div className="mt-3">
            <LinkButton href="/api/auth/silpo/start" full>
              Увійти через «Сільпо» для live-виклику
            </LinkButton>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-graphite-300">
          Токени зберігаються лише на сервері й ніколи не передаються в браузер. У цьому
          інтерфейсі вони не показуються навіть частково.
        </p>
      </Card>

      <SectionTitle>Живий виклик MCP</SectionTitle>
      <McpProbe />

      <SectionTitle>Інструменти агента</SectionTitle>
      <Card className="mb-4">
        <ul className="grid grid-cols-1 gap-1.5 text-[12px]">
          {AGENT_TOOLS.map((t) => (
            <li key={t.name} className="flex gap-2">
              <span className="font-mono text-accent-600">{t.name}</span>
              <span className="text-graphite-500">— {t.description}</span>
            </li>
          ))}
        </ul>
      </Card>

      <SectionTitle>Останні запуски агента</SectionTitle>
      <Card padded={false} className="mb-4 overflow-hidden">
        {runs.length === 0 ? (
          <p className="p-4 text-[13px] text-graphite-500">Запусків ще не було.</p>
        ) : (
          <ul className="divide-y divide-cream-200">
            {runs.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium leading-tight">{r.goal}</div>
                    <div className="mt-0.5 text-[11px] text-graphite-500">
                      {r.createdAt.toLocaleString('uk-UA')} · {r.durationMs} мс
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={r.status === 'done' ? 'success' : r.status === 'failed' ? 'danger' : 'neutral'}>
                      {r.status}
                    </Badge>
                    {r.liveMcpCalls > 0 && <Badge tone="info">{r.liveMcpCalls} live MCP</Badge>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="bg-cream-50">
        <div className="text-[13px] font-semibold text-graphite-700">Що НЕ потрапляє в трейс і логи</div>
        <ul className="mt-1.5 list-disc pl-4 text-[12px] leading-relaxed text-graphite-500">
          <li>access token і refresh token</li>
          <li>телефон, email, повна адреса</li>
          <li>номер картки лояльності (лише останні 4 цифри)</li>
          <li>внутрішні ідентифікатори, не потрібні для демонстрації</li>
        </ul>
      </Card>
    </main>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-graphite-500">{label}</span>
      <span className={`min-w-0 truncate text-right font-medium ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value}
      </span>
    </div>
  )
}

const AGENT_TOOLS = [
  { name: 'getHouseholdContext', description: 'склад родини, бюджет, ліміт часу' },
  { name: 'getFoodRestrictions', description: 'алергії, дієти, небажані продукти' },
  { name: 'analyzePantryPhotos', description: 'Claude multimodal → структурований JSON' },
  { name: 'getPantryInventory', description: 'актуальні домашні залишки' },
  { name: 'updatePantryInventory', description: 'WRITE, лише після підтвердження' },
  { name: 'importPantryFromReceipts', description: 'інференс комори з чеків «Сільпо»' },
  { name: 'findExpiringProducts', description: 'що треба спожити найближчим часом' },
  { name: 'generateRecipeOptions', description: 'скоринг страв за 6 факторами' },
  { name: 'calculateMissingIngredients', description: 'чого не вистачає, з урахуванням замін' },
  { name: 'searchSilpoProducts', description: 'MCP: пошук товарів у каталозі' },
  { name: 'compareProductOptions', description: 'бюджетний / оптимальний / преміальний' },
  { name: 'compareCookVsReadyMeal', description: 'готувати вдома vs купити готове' },
  { name: 'createShoppingProposal', description: 'чернетка кошика + токен підтвердження' },
  { name: 'addConfirmedItemsToCart', description: 'WRITE у кошик, лише з токеном' },
  { name: 'getCartSummary', description: 'кошик, купони, балабонуси, слоти' },
  { name: 'recordCookedMeal', description: 'списання інгредієнтів після готування' },
]
