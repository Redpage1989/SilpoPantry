/**
 * Разове дослідження живого MCP для збирання контексту доставки.
 * Тільки read-операції.  npm run mcp:explore
 */
import { PrismaClient } from '@prisma/client'
import { McpHttpClient, extractToolJson } from '../src/lib/mcp/client'
import { sanitizeForTrace } from '../src/lib/mcp/pii'

const prisma = new PrismaClient()

async function main() {
  const s = await prisma.mcpSession.findFirst({ orderBy: { updatedAt: 'desc' } })
  if (!s) throw new Error('немає сесії')
  const c = new McpHttpClient({ url: 'https://mcp.silpo.ua/mcp', accessToken: s.accessToken, retries: 4 })
  const tools = await c.listTools()

  for (const n of ['silpo_list_branches', 'silpo_get_available_delivery_types', 'silpo_get_time_slots', 'silpo_find_products_batch']) {
    const t = tools.find((x) => x.name === n)
    if (!t) continue
    const sc = t.inputSchema as { properties?: Record<string, { type?: string; description?: string; enum?: unknown[]; items?: unknown }>; required?: string[] }
    console.log(`\n### ${n}   required: ${JSON.stringify(sc.required ?? [])}`)
    for (const [k, v] of Object.entries(sc.properties ?? {})) {
      const enums = v.enum ? ` enum=${JSON.stringify(v.enum)}` : ''
      const desc = v.description ? ` — ${v.description.slice(0, 110)}` : ''
      console.log(`   · ${k}: ${v.type ?? '?'}${enums}${desc}`)
    }
  }

  const call = async (n: string, a: Record<string, unknown>) => {
    try {
      const r = extractToolJson(await c.callTool(n, a))
      console.log(`\n>>> ${n} ${JSON.stringify(a)}`)
      console.log(JSON.stringify(sanitizeForTrace(r)).slice(0, 800))
      return r as Record<string, unknown>
    } catch (e) {
      console.log(`\n>>> ${n} ПОМИЛКА: ${e instanceof Error ? e.message : e}`)
      return null
    }
  }

  // Повний ланцюжок bootstrap: філія → слот → каталог
  const branches = await call('silpo_list_branches', { limit: 5, hasPickup: true })
  const list = (branches?.branches ?? []) as Record<string, string>[]
  const branch = list.find((b) => b.open) ?? list[0]
  console.log(`\n🏬 обрана філія: ${branch?.branchId} (${branch?.city}), companyId є: ${!!branch?.companyId}`)

  const slots = await call('silpo_get_time_slots', { branchId: branch.branchId, limit: 3 })
  console.log('\n⏱ форма слотів:', JSON.stringify(Object.keys(slots ?? {})))
  const rawSlots = ((slots?.timeslots ?? slots?.slots ?? slots?.items) ?? []) as Record<string, unknown>[]
  console.log('   перший слот:', JSON.stringify(rawSlots[0] ?? null).slice(0, 200))

  for (const lim of [25, 48]) {
    const r = await call('silpo_get_time_slots', { branchId: branch.branchId, limit: lim })
    const a = ((r?.slots ?? []) as Record<string, unknown>[])
    console.log(`   limit=${lim}: слотів ${a.length}, доступних ${a.filter((x) => x.available === true).length}`)
  }

  // Чи потрібен саме ДОСТУПНИЙ слот для каталогу, чи будь-який валідний?
  const r3 = await call('silpo_get_time_slots', { branchId: branch.branchId, limit: 25 })
  const slots3 = ((r3?.slots ?? []) as Record<string, unknown>[])
  const chosen = slots3.find((x) => x.available === true) ?? slots3[slots3.length - 1] ?? slots3[0]
  console.log(`\n   пробую каталог зі слотом available=${chosen?.available}`)

  const found = await call('silpo_find_products_batch', {
    branchId: branch.branchId,
    deliveryType: chosen?.deliveryType ?? 'SelfPickup',
    timeslotStart: chosen?.start,
    timeslotEnd: chosen?.end,
    products: ['маскарпоне'],
    limit: 3,
  })
  if (found && typeof found === 'object') {
    const keys = Object.keys(found as Record<string, unknown>)
    console.log('\n🔑 верхні ключі каталогу:', JSON.stringify(keys.slice(0, 12)))
  }

  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await prisma.$disconnect(); process.exit(1) })
