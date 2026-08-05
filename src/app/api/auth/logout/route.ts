import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/session'

/** Вихід. MCP-токени лишаються на сервері й видаляються разом із користувачем. */
export async function POST() {
  await clearSession()
  return NextResponse.json({ ok: true })
}
