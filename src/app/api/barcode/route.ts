import { z } from 'zod'
import { handle } from '@/lib/api'
import { resolveAdapterSafe } from '@/lib/mcp'
import { parseBarcode } from '@/lib/domain/barcode'
import { normalizeProductName, guessCategory, defaultUnit } from '@/lib/domain/normalize'
import { toPantryUnit } from '@/lib/domain/types'

const Input = z.object({ code: z.string().min(6).max(20) })

/**
 * Пошук товару за штрихкодом.
 *
 * Контрольна сума перевіряється ДО звернення до каталогу: камера регулярно
 * видає майже-правильні цифри, і шукати їх у «Сільпо» — марна витрата
 * запиту й порожній екран для користувача.
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 30 }, async (userId) => {
    const { code } = Input.parse(await request.json())
    const parsed = parseBarcode(code)
    if (!parsed) {
      return {
        ok: false,
        reason: 'invalid_checksum' as const,
        message: 'Код не схожий на штрихкод. Спробуйте відсканувати ще раз або введіть вручну.',
      }
    }

    const { adapter, reason } = await resolveAdapterSafe(userId)
    const product = await adapter.findByBarcode(parsed.code).catch(() => null)
    const trace = adapter.drainTrace()

    if (!product) {
      return {
        ok: false,
        reason: 'not_found' as const,
        barcode: parsed,
        mode: adapter.mode,
        modeReason: reason,
        message: 'Товару з таким кодом немає в каталозі «Сільпо». Додайте його вручну.',
        trace,
      }
    }

    const normalizedName = normalizeProductName(product.name)
    const guess = guessCategory(normalizedName)
    return {
      ok: true as const,
      barcode: parsed,
      mode: adapter.mode,
      modeReason: reason,
      // готова до підтвердження позиція комори
      item: {
        originalName: product.name,
        normalizedName,
        category: guess.category,
        storageLocation: guess.storageLocation,
        // якщо каталог не дав ваги (unit === 'уп'), беремо одну штуку
        quantity: product.unit === 'уп' ? 1 : product.packSize,
        unit: product.unit === 'уп' ? toPantryUnit(defaultUnit(normalizedName)) : toPantryUnit(product.unit),
        confidence: 1,
        productId: product.productId,
      },
      trace,
    }
  })
}
