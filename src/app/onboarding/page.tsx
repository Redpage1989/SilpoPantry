import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/session'
import { prisma } from '@/lib/db'
import { resolveAdapterSafe } from '@/lib/mcp'
import { OnboardingForm } from './OnboardingForm'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const userId = await getUserId()
  if (!userId) redirect('/login')

  const [user, { adapter, reason }] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { members: true, restrictions: true } }),
    resolveAdapterSafe(userId),
  ])

  // Дані з «Сільпо» підставляємо як чернетку — користувач може все змінити
  const [profile, family, restrictions] = await Promise.all([
    adapter.getProfile().catch(() => null),
    adapter.getFamily().catch(() => []),
    adapter.getRestrictions().catch(() => []),
  ])

  const prefill = {
    displayName: user?.displayName || profile?.displayName || 'Гість',
    members:
      user && user.members.length > 0
        ? user.members.map((m) => ({
            name: m.name,
            type: m.type as 'adult' | 'child' | 'teen' | 'senior',
            age: m.age ?? undefined,
            preferences: safeArray(m.preferences),
          }))
        : family.map((m) => ({ name: m.name, type: m.type, age: m.age, preferences: [] as string[] })),
    restrictions:
      user && user.restrictions.length > 0
        ? user.restrictions.map((r) => ({
            restrictionType: r.restrictionType as 'allergy' | 'intolerance' | 'diet' | 'dislike' | 'religious',
            value: r.value,
            severity: r.severity as 'critical' | 'high' | 'medium' | 'low',
            memberName: undefined as string | undefined,
          }))
        : restrictions.map((r) => ({
            restrictionType: r.restrictionType,
            value: r.value,
            severity: r.severity,
            memberName: r.memberName,
          })),
    weeklyBudget: user?.weeklyBudget ?? 250_00,
    mealsPerDay: user?.mealsPerDay ?? 3,
    maxCookMinutes: user?.maxCookMinutes ?? 40,
  }

  return (
    <main className="safe-top px-4 pb-6 pt-4">
      <header className="mb-4">
        <h1 className="text-[22px] font-bold tracking-tight">Налаштування родини</h1>
        <p className="text-[13px] text-graphite-500">
          {adapter.mode === 'live'
            ? 'Дані попередньо заповнено з вашого профілю «Сільпо». Перевірте й доповніть.'
            : `Демонстраційні дані. ${reason}`}
        </p>
      </header>

      <OnboardingForm prefill={prefill} mode={adapter.mode} />
    </main>
  )
}

function safeArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
