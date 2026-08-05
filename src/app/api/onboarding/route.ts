import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { resolveAdapterSafe } from '@/lib/mcp'

const Member = z.object({
  name: z.string().min(1).max(40),
  type: z.enum(['adult', 'child', 'teen', 'senior']),
  age: z.number().int().min(0).max(120).optional(),
  preferences: z.array(z.string().max(30)).max(10).default([]),
})

const Restriction = z.object({
  restrictionType: z.enum(['allergy', 'intolerance', 'diet', 'dislike', 'religious']),
  value: z.string().min(1).max(40),
  severity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  memberName: z.string().max(40).optional(),
})

const Input = z.object({
  displayName: z.string().min(1).max(40),
  members: z.array(Member).min(1).max(8),
  restrictions: z.array(Restriction).max(20).default([]),
  weeklyBudget: z.number().int().min(0).max(10_000_00).nullable(),
  mealsPerDay: z.number().int().min(1).max(6),
  maxCookMinutes: z.number().int().min(10).max(180),
})

/** Попереднє заповнення форми з даних «Сільпо» через MCP. */
export async function GET(request: Request) {
  return handle(request, {}, async (userId) => {
    const { adapter, reason } = await resolveAdapterSafe(userId)
    const [profile, family, restrictions] = await Promise.all([
      adapter.getProfile().catch(() => null),
      adapter.getFamily().catch(() => []),
      adapter.getRestrictions().catch(() => []),
    ])
    return {
      mode: adapter.mode,
      modeReason: reason,
      prefill: { profile, family, restrictions },
      trace: adapter.drainTrace(),
    }
  })
}

/** Збереження налаштувань родини. */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 20 }, async (userId) => {
    const input = Input.parse(await request.json())

    await prisma.foodRestriction.deleteMany({ where: { userId } })
    await prisma.householdMember.deleteMany({ where: { userId } })

    await prisma.user.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        weeklyBudget: input.weeklyBudget,
        mealsPerDay: input.mealsPerDay,
        maxCookMinutes: input.maxCookMinutes,
        onboardedAt: new Date(),
      },
    })

    const created = new Map<string, string>()
    for (const m of input.members) {
      const row = await prisma.householdMember.create({
        data: {
          userId,
          name: m.name,
          type: m.type,
          age: m.age,
          preferences: JSON.stringify(m.preferences),
        },
      })
      created.set(m.name, row.id)
    }

    for (const r of input.restrictions) {
      await prisma.foodRestriction.create({
        data: {
          userId,
          memberId: r.memberName ? created.get(r.memberName) : undefined,
          restrictionType: r.restrictionType,
          value: r.value,
          severity: r.severity,
        },
      })
    }

    return { ok: true, members: input.members.length, restrictions: input.restrictions.length }
  })
}
