/**
 * Перевірка WRITE-операцій на РЕАЛЬНОМУ кошику «Сільпо».
 *
 * Сценарій навмисно оборотний: додати один товар → пересвідчитись →
 * прибрати його назад. Кошик користувача лишається таким, яким був.
 */
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

  console.log('\n① ЗНІМАЮ ПОЧАТКОВИЙ СТАН')
  const before = await a.getCart()
  console.log(`   позицій: ${before.lines.length}, разом: ${formatUah(before.total)}`)
  const beforeIds = new Set(before.lines.map((l) => l.productId))

  console.log('\n② ШУКАЮ ТОВАР, ЯКОГО В КОШИКУ ЩЕ НЕМАЄ')
  const found = await a.findProducts([{ ingredientKey: 'савоярді', query: 'печиво савоярді', limit: 5 }])
  const candidate = found[0]?.products.find((p) => !beforeIds.has(p.productId))
  if (!candidate) throw new Error('не знайшов придатного товару для тесту')
  console.log(`   обрано: ${candidate.name.slice(0, 60)} — ${formatUah(candidate.promoPrice ?? candidate.price)}`)

  console.log('\n③ ДОДАЮ ДО КОШИКА (silpo_add_or_update_cart_products)')
  const afterAdd = await a.addToCart([{ productId: candidate.productId, quantity: 1 }])
  const added = afterAdd.lines.find((l) => l.productId === candidate.productId)
  console.log(`   позицій: ${before.lines.length} → ${afterAdd.lines.length}`)
  console.log(`   товар у кошику: ${added ? '✅ ТАК, × ' + added.quantity : '❌ НІ'}`)
  console.log(`   разом: ${formatUah(before.total)} → ${formatUah(afterAdd.total)}`)

  console.log('\n④ ПРИБИРАЮ НАЗАД (silpo_remove_cart_products)')
  const afterRemove = await a.removeFromCart([candidate.productId])
  const stillThere = afterRemove.lines.some((l) => l.productId === candidate.productId)
  console.log(`   позицій: ${afterAdd.lines.length} → ${afterRemove.lines.length}`)
  console.log(`   товар прибрано: ${stillThere ? '❌ НІ, лишився' : '✅ ТАК'}`)
  console.log(`   разом: ${formatUah(afterRemove.total)}`)

  const restored = afterRemove.lines.length === before.lines.length && afterRemove.total === before.total
  console.log(`\n${restored ? '✅' : '⚠️'} КОШИК ${restored ? 'ПОВЕРНУТО ДО ПОЧАТКОВОГО СТАНУ' : 'ВІДРІЗНЯЄТЬСЯ ВІД ПОЧАТКОВОГО — перевірте вручну'}`)

  const trace = a.drainTrace()
  const writes = trace.filter((t) => /add_or_update|remove/.test(t.tool))
  console.log(`\nWRITE-викликів у трейсі: ${writes.length}`)
  for (const w of writes) console.log(`   · ${w.tool} — ${w.ok ? 'ok' : 'FAIL'} (${w.durationMs} мс)`)

  const json = JSON.stringify(trace)
  const leaks = ['@gmail', '@ukr.net', 'Bearer '].filter((l) => json.includes(l))
  console.log(leaks.length ? `⚠️ PII у трейсі: ${leaks.join(', ')}` : '✅ PII у трейсі не знайдено')

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('\n❌ ' + (e instanceof Error ? e.message : e)); await prisma.$disconnect(); process.exit(1) })
