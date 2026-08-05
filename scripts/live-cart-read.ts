/** Тільки читання реального кошика «Сільпо». Нічого не змінює. */
import { PrismaClient } from '@prisma/client'
import { McpHttpClient } from '../src/lib/mcp/client'
import { LiveSilpoAdapter } from '../src/lib/mcp/live-adapter'
import { formatUah } from '../src/lib/domain/scoring'

const prisma = new PrismaClient()

async function main() {
  const s = await prisma.mcpSession.findFirst({ orderBy: { updatedAt: 'desc' } })
  if (!s) throw new Error('немає сесії')
  const a = new LiveSilpoAdapter(
    new McpHttpClient({ url: 'https://mcp.silpo.ua/mcp', accessToken: s.accessToken, retries: 4 }),
  )
  const cart = await a.getCart()
  console.log(`\ncartId:      ${cart.cartId ? cart.cartId.slice(0, 8) + '…' : '— НЕМАЄ'}`)
  console.log(`branchId:    ${cart.branchId ? cart.branchId.slice(0, 8) + '…' : '—'}`)
  console.log(`deliveryType:${cart.deliveryType ?? '—'}`)
  console.log(`timeSlotId:  ${cart.timeSlotId ?? '—'}`)
  console.log(`позицій:     ${cart.lines.length}`)
  for (const l of cart.lines) console.log(`   · ${l.name.slice(0, 55)} × ${l.quantity} — ${formatUah(l.price)}`)
  console.log(`сума:        ${formatUah(cart.subtotal)} · знижка ${formatUah(cart.discount)} · разом ${formatUah(cart.total)}`)
  console.log(`валідації:   ${cart.validations.length ? cart.validations.join('; ') : '—'}`)
  console.log(`checkout:    ${cart.checkoutUrl ?? '—'}`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1) })
