import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { setSession } from '@/lib/session'
import { errorResponse } from '@/lib/api'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Запуск demo-режиму. Створює (або перевикористовує) демонстраційного
 * користувача з seed-даними. Жодних персональних даних не збирає.
 */
export async function POST() {
  try {
    const user = await prisma.user.upsert({
      where: { id: 'demo-user' },
      update: {},
      create: {
        id: 'demo-user',
        displayName: 'Антон',
        authMode: 'demo',
        weeklyBudget: 250_00,
        mealsPerDay: 3,
        maxCookMinutes: 40,
        onboardedAt: new Date(),
      },
    })
    await setSession(user.id)
    logEvent('info', 'auth.demo_started', {})
    return NextResponse.json({ ok: true, mode: 'demo', displayName: user.displayName })
  } catch (err) {
    return errorResponse(err)
  }
}
