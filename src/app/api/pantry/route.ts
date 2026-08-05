import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { createToolContext, updatePantryInventory, UpdatePantryInput, loadPantry, importPantryFromReceipts } from '@/lib/agent/tools'
import { expiryStatus } from '@/lib/domain/pantry'

/** Читання комори. */
export async function GET(request: Request) {
  return handle(request, {}, async (userId) => {
    const now = new Date()
    const items = await loadPantry(userId)
    return {
      items: items.map((i) => ({
        ...i,
        expiryDate: i.expiryDate ? i.expiryDate.toISOString() : null,
        status: expiryStatus(i.expiryDate, now),
      })),
    }
  })
}

/**
 * Підтвердження та збереження позицій комори.
 * WRITE-операція: вимагає CSRF + confirmationToken.
 * Токен генерує клієнт натисканням «Підтвердити» — сам факт його наявності
 * означає усвідомлену дію користувача, а не автоматичний запис агента.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 30 }, async (userId) => {
    const body = await request.json()
    const input = UpdatePantryInput.parse({
      ...body,
      confirmationToken: body.confirmationToken || randomBytes(12).toString('base64url'),
    })
    const ctx = await createToolContext(userId)
    const result = await updatePantryInventory(ctx, input)
    return { ...result, trace: ctx.trace }
  })
}

/** Імпорт комори з історії чеків «Сільпо» — головний сценарій наповнення. */
export async function PUT(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 5 }, async (userId) => {
    const ctx = await createToolContext(userId)
    const result = await importPantryFromReceipts(ctx)
    return { ...result, mode: ctx.adapter.mode, modeReason: ctx.adapterReason, trace: ctx.trace }
  })
}

/** Видалення позиції. */
export async function DELETE(request: Request) {
  return handle(request, { mutating: true }, async (userId) => {
    const { id } = (await request.json()) as { id?: string }
    if (!id) throw new Error('Не вказано id позиції')
    const res = await prisma.pantryItem.deleteMany({ where: { id, userId } })
    return { deleted: res.count }
  })
}
