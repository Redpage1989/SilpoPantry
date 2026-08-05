import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resetDemoCart } from '@/lib/mcp/mock-adapter'
import { seedDemoUser, seedRecipes } from '@/lib/seed/demo'
import { errorResponse } from '@/lib/api'
import { getUserId } from '@/lib/session'

/**
 * Скидання demo-стану до seed-значень.
 *
 * Потрібне для ізоляції E2E: тести ділять одного демо-користувача, і без
 * скидання один тест «зʼїдає» шпинат, від якого залежить інший.
 *
 * У production маршрут вимкнено назавжди — відповідає 404.
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const userId = (await getUserId()) ?? 'demo-user'
    await resetDemoCart(userId)
    await seedRecipes(prisma)
    const result = await seedDemoUser(prisma, userId)
    return NextResponse.json({ ok: true, userId, ...result })
  } catch (err) {
    return errorResponse(err)
  }
}
