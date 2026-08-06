import { prisma } from '@/lib/db'
import { handle } from '@/lib/api'
import { config } from '@/lib/config'
import { assertValidImage, stripMetadata, toBase64, ImageValidationError } from '@/lib/ai/image'
import { createToolContext, analyzePantryPhotosTool } from '@/lib/agent/tools'
import type { PhotoInput } from '@/lib/ai/vision'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Розпізнавання продуктів на фото.
 *
 * Що робимо з фото:
 *  · перевіряємо тип за сигнатурою (не за заголовком),
 *  · обмежуємо розмір,
 *  · видаляємо EXIF/GPS ДО того, як байти кудись поїдуть,
 *  · не зберігаємо файл на диску — тримаємо в памʼяті лише на час виклику,
 *  · у RecognitionJob пишемо тільки результат і TTL, без самого зображення.
 *
 * Результат ЗАВЖДИ повертається як «потребує підтвердження».
 */
export async function POST(request: Request) {
  return handle(request, { mutating: true, rateLimitPerMinute: 10, rateLimitKey: 'scan' }, async (userId) => {
    const form = await request.formData()
    const files = form.getAll('photos').filter((f): f is File => f instanceof File)
    if (files.length === 0) throw new ImageValidationError('Додайте щонайменше одне фото')
    if (files.length > 5) throw new ImageValidationError('За раз можна завантажити до 5 фото')

    const hints = form.getAll('hints').map(String)
    const photos: PhotoInput[] = []

    for (const [index, file] of files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      assertValidImage(bytes, file.type, config.limits.maxUploadBytes)
      const cleaned = stripMetadata(bytes, file.type)
      photos.push({
        base64: toBase64(cleaned),
        mime: file.type,
        hint: (hints[index] as PhotoInput['hint']) ?? 'fridge',
      })
      logEvent('info', 'scan.photo_accepted', {
        index,
        originalBytes: bytes.byteLength,
        strippedBytes: cleaned.byteLength,
        mime: file.type,
      })
    }

    /**
     * Чистимо прострочені записи ПЕРЕД створенням нового.
     *
     * Поле `expiresAt` існувало від початку, але його ніхто не перевіряв:
     * TTL був обіцянкою в схемі, а не поведінкою. Прибирання тут, а не в
     * cron, — свідомий вибір: окремий планувальник у прототипі це ще один
     * механізм, який може тихо зупинитись і про це ніхто не дізнається.
     * Сканування — єдине місце, де ці записи взагалі зʼявляються.
     */
    const purged = await prisma.recognitionJob.deleteMany({
      where: { userId, expiresAt: { lt: new Date() } },
    })
    if (purged.count > 0) logEvent('info', 'scan.purged_expired', { count: purged.count })

    const expiresAt = new Date(Date.now() + config.limits.photoTtlMinutes * 60_000)
    const job = await prisma.recognitionJob.create({
      data: { userId, imageKey: `mem:${Date.now()}`, status: 'processing', expiresAt },
    })

    const ctx = await createToolContext(userId)
    try {
      const outcome = await analyzePantryPhotosTool(ctx, photos)
      await prisma.recognitionJob.update({
        where: { id: job.id },
        data: {
          status: 'done',
          engine: outcome.engine,
          rawResult: JSON.stringify(outcome.enriched),
        },
      })
      return {
        jobId: job.id,
        engine: outcome.engine,
        note: outcome.note,
        // усе, що прийшло з фото, за визначенням потребує підтвердження
        items: outcome.enriched.map((item) => ({
          ...item,
          expiryDate: item.expiryDate ? item.expiryDate.toISOString() : null,
          needsConfirmation: true,
        })),
        trace: ctx.trace,
      }
    } catch (err) {
      await prisma.recognitionJob.update({
        where: { id: job.id },
        data: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
      })
      throw err
    }
  })
}

/** Видалення історії розпізнавань — вимога приватності. */
export async function DELETE(request: Request) {
  return handle(request, { mutating: true }, async (userId) => {
    const res = await prisma.recognitionJob.deleteMany({ where: { userId } })
    return { deleted: res.count }
  })
}
