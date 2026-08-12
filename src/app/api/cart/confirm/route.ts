import { z } from 'zod'
import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { createToolContext, addConfirmedItemsToCart, getCartSummary, type ProposalLine } from '@/lib/agent/tools'

/** Рядки пропозиції зберігаються як JSON; пошкоджений запис не має валити маршрут. */
function parseLines(raw: string): ProposalLine[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ProposalLine[]) : []
  } catch {
    return []
  }
}

const Input = z.object({
  proposalId: z.string().min(1),
  confirmationToken: z.string().min(8),
  /** користувач міг перемкнути ціновий рівень перед підтвердженням */
  tier: z.enum(['budget', 'optimal', 'premium']).optional(),
  /**
   * Які саме товари обрав користувач.
   *
   * Свідомо приймаємо ЛИШЕ ідентифікатори, а не характеристики товару.
   * Вага, крок і ціна беруться з `productOptions` пропозиції — з того, що
   * сервер сам порахував і показав. Інакше кількість кілограмів у кошику
   * визначали б дані з браузера: досить надіслати «ваговий товар із кроком
   * 100 кг», щоб замовити тонну сиру.
   */
  selection: z.array(z.string().min(1)).max(60).optional(),
})

/**
 * ЄДИНА точка, яка змінює кошик «Сільпо».
 *
 * Три бар'єри перед write-викликом MCP:
 *   1. CSRF-токен (double submit),
 *   2. одноразовий confirmationToken пропозиції,
 *   3. звірка, що пропозиція належить саме цьому користувачу і ще не додана.
 *
 * Агент не має жодного шляху додати товари в обхід цього маршруту.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10 }, async (userId) => {
    const input = Input.parse(await request.json())

    /**
     * Статус пропозиції тут навмисно НЕ перевіряємо.
     *
     * Нова пропозиція скасовує попередні з тією ж метою (щоб екран кошика
     * не заростав дублями). Але користувач може дивитись на екран, який
     * побудували раніше, — і його підтвердження має спрацювати. Гарантією
     * є одноразовий confirmationToken, а не статус рядка; повторне
     * додавання все одно відсікається перевіркою `added_to_cart`.
     */
    const proposal = await prisma.shoppingProposal.findFirst({
      where: { id: input.proposalId, userId },
    })
    if (!proposal) throw new Error('Пропозицію не знайдено')

    // Користувач змінив вибір товарів — перебираємо рядки з ВЛАСНИХ даних сервера
    if (input.selection && input.selection.length > 0) {
      const options = parseLines(proposal.productOptions)
      if (options.length === 0) {
        throw new Error(
          'Ця пропозиція створена до оновлення застосунку — відкрийте страву заново, щоб змінити вибір товарів',
        )
      }
      const chosen = new Set(input.selection)
      const byIngredient = new Map<string, ProposalLine>()
      for (const line of options) {
        if (chosen.has(line.productId)) byIngredient.set(line.normalizedName, line)
      }
      const lines = [...byIngredient.values()]
      if (lines.length === 0) {
        throw new Error('Обрані товари не належать цій пропозиції')
      }
      await prisma.shoppingProposal.update({
        where: { id: proposal.id },
        data: {
          selectedProducts: JSON.stringify(lines),
          totalPrice: lines.reduce((sum, l) => sum + l.lineTotal, 0),
        },
      })
    }

    const ctx = await createToolContext(userId)
    const cart = await addConfirmedItemsToCart(ctx, {
      proposalId: input.proposalId,
      confirmationToken: input.confirmationToken,
    })
    const summary = await getCartSummary(ctx)

    return {
      mode: ctx.adapter.mode,
      modeReason: ctx.adapterReason,
      cart,
      summary,
      trace: ctx.trace,
    }
  })
}
