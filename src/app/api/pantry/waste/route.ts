import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { logEvent } from '@/lib/mcp/pii'

const Input = z.object({ id: z.string().min(1) })

/**
 * «Я це викинув» — позиція покидає комору як втрата, а не як спожите.
 *
 * Окрема дія від видалення. `DELETE /api/pantry` стирає рядок повністю: це
 * виправлення помилки розпізнавання, продукту ніколи не було вдома. Тут же
 * продукт БУВ і зіпсувався — і саме ця різниця дає метриці «спожито вчасно
 * проти викинутого» знаменник. Комора, яка не вміє записати викинуте, не
 * може стверджувати, що зменшує втрати.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 30 }, async (userId) => {
    const { id } = Input.parse(await request.json())

    const item = await prisma.pantryItem.findFirst({ where: { id, userId } })
    if (!item) throw new Error('Позицію не знайдено')
    if (item.consumedAt) throw new Error('Ця позиція вже покинула комору')

    await prisma.pantryItem.update({
      where: { id },
      data: { quantity: 0, consumedAt: new Date(), disposal: 'wasted' },
    })
    logEvent('info', 'pantry.wasted', {})

    return {
      ok: true,
      note: `«${item.originalName}» позначено як викинуте. Це впаде в метрику втрат — саме для того вона й потрібна.`,
    }
  })
}
