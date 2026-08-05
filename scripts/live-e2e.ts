/**
 * Наскрізна перевірка LiveSilpoAdapter на справжньому MCP «Сільпо».
 * ТІЛЬКИ read-операції: кошик не змінюється.
 *
 *   npm run mcp:e2e
 */
import { PrismaClient } from '@prisma/client'
import { McpHttpClient } from '../src/lib/mcp/client'
import { LiveSilpoAdapter } from '../src/lib/mcp/live-adapter'
import { formatUah } from '../src/lib/domain/scoring'

const prisma = new PrismaClient()

async function main() {
  const s = await prisma.mcpSession.findFirst({ orderBy: { updatedAt: 'desc' } })
  if (!s) throw new Error('Немає MCP-сесії — увійдіть через «Сільпо» на /trace')

  const client = new McpHttpClient({ url: 'https://mcp.silpo.ua/mcp', accessToken: s.accessToken, retries: 4 })
  const a = new LiveSilpoAdapter(client)
  const step = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      const started = Date.now()
      const r = await fn()
      console.log(`✅ ${label.padEnd(22)} ${Date.now() - started} мс`)
      return r
    } catch (e) {
      console.log(`❌ ${label.padEnd(22)} ${e instanceof Error ? e.message.slice(0, 120) : e}`)
      return null
    }
  }

  console.log('\n── ПРОФІЛЬ І РОДИНА ──')
  const profile = await step('getProfile', () => a.getProfile())
  if (profile) console.log(`   імʼя: ${profile.displayName}, картка: ${profile.loyaltyCardMasked ?? '—'}`)
  const family = await step('getFamily', () => a.getFamily())
  if (family) console.log(`   членів родини: ${family.length}`)
  const restr = await step('getRestrictions', () => a.getRestrictions())
  if (restr) console.log(`   обмежень: ${restr.length}`)
  const loyalty = await step('getLoyalty', () => a.getLoyalty())
  if (loyalty) console.log(`   балабонусів: ${loyalty.balabonuses}`)

  console.log('\n── КАТАЛОГ (bootstrap контексту доставки) ──')
  const found = await step('findProducts', () =>
    a.findProducts([
      { ingredientKey: 'маскарпоне', query: 'маскарпоне', limit: 3 },
      { ingredientKey: 'савоярді', query: 'печиво савоярді', limit: 3 },
    ]),
  )
  if (found) {
    for (const g of found) {
      console.log(`   «${g.ingredientKey}»: ${g.products.length} товарів`)
      for (const p of g.products.slice(0, 3)) {
        const promo = p.promoPrice ? ` (акція ${formatUah(p.promoPrice)}, було ${formatUah(p.price)})` : ` ${formatUah(p.price)}`
        console.log(`     · ${p.name.slice(0, 55)} — ${p.packSize} ${p.unit}${promo}`)
      }
    }
  }

  const first = found?.[0]?.products?.[0]
  if (first?.slug) {
    const details = await step('getProductDetails', () => a.getProductDetails(first.slug!))
    if (details) console.log(`   деталі: ${details.name.slice(0, 60)}`)
  }

  console.log('\n── ДОСТАВКА ТА КОШИК ──')
  const slots = await step('getTimeSlots', () => a.getTimeSlots())
  if (slots) console.log(`   слотів: ${slots.length}, доступних: ${slots.filter((x) => x.available).length}`)
  const cart = await step('getCart', () => a.getCart())
  if (cart) console.log(`   позицій: ${cart.lines.length}, разом: ${formatUah(cart.total)}`)

  console.log('\n── ТРЕЙС (перевірка маскування) ──')
  const trace = a.drainTrace()
  console.log(`   записів: ${trace.length}, live: ${trace.filter((t) => t.mode === 'live').length}`)
  const json = JSON.stringify(trace)
  const leaks = ['@gmail', '@ukr.net', '+380', 'Bearer ']
  const found2 = leaks.filter((l) => json.includes(l))
  console.log(found2.length ? `   ⚠️  ЗНАЙДЕНО В ТРЕЙСІ: ${found2.join(', ')}` : '   ✅ PII у трейсі не знайдено')

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('\n' + (e instanceof Error ? e.message : e)); await prisma.$disconnect(); process.exit(1) })
