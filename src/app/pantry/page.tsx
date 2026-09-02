import Link from 'next/link'
import { redirect } from 'next/navigation'
import { WasteButton } from './WasteButton'
import { getUserId } from '@/lib/session'
import { loadPantry, loadHouseholdBasics } from '@/lib/agent/tools'
import { resolveAdapterSafe } from '@/lib/mcp'
import { Badge, Card, ModeBadge, SectionTitle, Stat } from '@/components/ui'
import { STORAGE_LABELS, SOURCE_LABELS, type StorageLocation, type PantrySource } from '@/lib/domain/types'
import { expiryStatus, daysUntil, EXPIRY_LABELS, estimateDaysOfFood, STAPLES, confidenceLabel, confidenceTone } from '@/lib/domain/pantry'
import { pluralize, formatUah } from '@/lib/domain/scoring'
import { formatQuantity } from '@/lib/domain/units'
import { displayName } from '@/lib/domain/normalize'
import { PantryActions } from './PantryActions'

export const dynamic = 'force-dynamic'

const ORDER: StorageLocation[] = ['fridge', 'freezer', 'produce', 'pantry', 'drinks', 'snacks', 'baby', 'other']

export default async function PantryPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  const [items, { adapter, reason }, household] = await Promise.all([
    loadPantry(userId),
    resolveAdapterSafe(userId),
    loadHouseholdBasics(userId),
  ])
  const now = new Date()

  /**
   * Показники й «докупити» переїхали сюди з головної.
   *
   * Обидва блоки — про стан комори, а не про те, що приготувати сьогодні.
   * На головній вони були двома з восьми карток однакової ваги й тягнули
   * увагу на себе, не будучи причиною відкрити застосунок.
   */
  const daysOfFood = estimateDaysOfFood(items, household.people, household.mealsPerDay)
  const have = new Set(items.map((i) => i.normalizedName))
  const restock = STAPLES.filter((name) => !have.has(name))

  const grouped = ORDER.map((location) => ({
    location,
    items: items.filter((i) => i.storageLocation === location),
  })).filter((g) => g.items.length > 0)

  const needConfirm = items.filter((i) => i.needsConfirmation).length

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Домашня комора</h1>
          <p className="text-[13px] text-graphite-500">
            {items.length} позицій
            {needConfirm > 0 && ` · ${needConfirm} потребують підтвердження`}
          </p>
        </div>
        <ModeBadge mode={adapter.mode} reason={reason} />
      </header>

      <PantryActions />

      <Card className="mb-4 mt-4">
        <div className="flex gap-3">
          <Stat
            label="Вистачить продуктів"
            value={
              daysOfFood < 1
                ? 'менше дня'
                : `≈ ${Math.round(daysOfFood)} ${pluralize(Math.round(daysOfFood), 'день', 'дні', 'днів')}`
            }
            hint={`на ${household.people} ос.`}
          />
          <div className="w-px bg-cream-200" />
          <Stat
            label="Базових продуктів бракує"
            value={String(restock.length)}
            hint={restock.length > 0 ? restock.slice(0, 3).map(displayName).join(', ') : 'усе на місці'}
          />
          <div className="w-px bg-cream-200" />
          {/* Повернуто після рев'ю: показник зник із головної «переїхавши» в нікуди,
              хоча людина задавала бюджет в онбордингу й має його десь бачити */}
          <Stat
            label="Бюджет на тиждень"
            value={household.weeklyBudget ? formatUah(household.weeklyBudget) : '—'}
            hint={household.weeklyBudget ? 'задано в налаштуваннях' : 'не заданий'}
          />
        </div>
        {/* Вхід до метрик саме звідси: комора показує, що лежить зараз,
            а «Що змінилось» — чи стає від цього краще з тижнями */}
        <Link
          href="/metrics"
          className="mt-3 block text-[12px] text-accent-700 underline underline-offset-2"
        >
          Що змінилось за час користування →
        </Link>
      </Card>

      {items.length === 0 && (
        <Card className="mt-4 text-center">
          <div className="mb-2 text-4xl" aria-hidden>
            🧺
          </div>
          <h2 className="text-[16px] font-semibold">Комора порожня</h2>
          <p className="mt-1 text-[13px] text-graphite-500">
            Найшвидший спосіб — імпортувати історію чеків «Сільпо». Далі уточніть фото холодильника.
          </p>
        </Card>
      )}

      {grouped.map((group) => (
        <div key={group.location} className="mt-5">
          <SectionTitle>{STORAGE_LABELS[group.location]}</SectionTitle>
          <Card padded={false} className="overflow-hidden">
            <ul className="divide-y divide-cream-200">
              {group.items.map((item) => {
                const status = expiryStatus(item.expiryDate, now)
                const days = item.expiryDate ? daysUntil(item.expiryDate, now) : null
                return (
                  <li key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-medium leading-tight">
                          {displayName(item.originalName)}
                        </div>
                        <div className="mt-0.5 text-[12px] text-graphite-500">
                          {formatQuantity(item.quantity, item.unit)} · {item.category}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone="neutral">{SOURCE_LABELS[item.source as PantrySource]}</Badge>
                          <Badge tone={confidenceTone(item.confidence)}>
                            {confidenceLabel(item.confidence)}
                          </Badge>
                          {item.needsConfirmation && <Badge tone="info">потребує підтвердження</Badge>}
                        </div>
                        <div className="mt-1.5">
                          <WasteButton id={item.id} name={displayName(item.originalName)} />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {status === 'unknown' ? (
                          <span className="text-[11px] text-graphite-300">термін невідомий</span>
                        ) : (
                          <Badge tone={statusTone(status)}>
                            {status === 'expired'
                              ? EXPIRY_LABELS.expired
                              : days === 0
                                ? 'Сьогодні'
                                : days === 1
                                  ? 'До завтра'
                                  : `${days} дн.`}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        </div>
      ))}

      <p className="mt-6 px-1 text-[11px] leading-relaxed text-graphite-300">
        Кількості з фото та чеків — оцінка, а не вимірювання. Фото не показує вміст закритої упаковки
        й точну вагу, тому такі позиції позначені як «потребують підтвердження».
      </p>
    </main>
  )
}

function statusTone(status: ReturnType<typeof expiryStatus>) {
  if (status === 'expired' || status === 'use_today') return 'danger' as const
  if (status === 'expiring_soon') return 'warn' as const
  return 'success' as const
}
