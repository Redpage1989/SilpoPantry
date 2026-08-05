/**
 * Робота із завантаженими фото: перевірка типу/розміру та видалення EXIF.
 *
 * EXIF ріжемо власним парсером сегментів, а не бібліотекою обробки зображень:
 * нам не потрібне перекодування (воно псує якість і їсть CPU), потрібно рівно
 * прибрати метадані — насамперед GPS-координати кухні користувача.
 */

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedMime = (typeof ALLOWED_MIME)[number]

export class ImageValidationError extends Error {}

export function assertValidImage(bytes: Uint8Array, mime: string, maxBytes: number): asserts mime is AllowedMime {
  if (!ALLOWED_MIME.includes(mime as AllowedMime)) {
    throw new ImageValidationError(`Непідтримуваний формат: ${mime}. Дозволені JPEG, PNG, WebP.`)
  }
  if (bytes.byteLength > maxBytes) {
    throw new ImageValidationError(`Файл завеликий: ${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ, ліміт ${(maxBytes / 1024 / 1024).toFixed(0)} МБ.`)
  }
  if (bytes.byteLength < 100) {
    throw new ImageValidationError('Файл порожній або пошкоджений.')
  }
  if (!magicMatches(bytes, mime)) {
    throw new ImageValidationError('Вміст файлу не відповідає заявленому типу.')
  }
}

/** Перевірка сигнатури, щоб .exe не проліз під виглядом image/jpeg. */
function magicMatches(b: Uint8Array, mime: string): boolean {
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  if (mime === 'image/webp') {
    return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45
  }
  return false
}

/** Прибирає метадані відповідно до формату. Повертає новий буфер. */
export function stripMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  if (mime === 'image/jpeg') return stripJpegMetadata(bytes)
  if (mime === 'image/png') return stripPngMetadata(bytes)
  return bytes // WebP: метадані в необовʼязкових чанках, які ми й так не читаємо
}

/**
 * JPEG: видаляємо всі APPn-сегменти (APP0…APP15) — там живуть EXIF (APP1),
 * XMP, IPTC і мініатюри, які теж можуть містити геодані.
 */
function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8]
  let i = 2
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = bytes[i + 1]
    // SOS — далі стиснуті дані, копіюємо решту як є
    if (marker === 0xda) {
      for (let j = i; j < bytes.length; j++) out.push(bytes[j])
      break
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker)
      i += 2
      continue
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    const isAppSegment = marker >= 0xe0 && marker <= 0xef
    const isComment = marker === 0xfe
    if (!isAppSegment && !isComment) {
      for (let j = i; j < i + 2 + length; j++) out.push(bytes[j])
    }
    i += 2 + length
  }
  return Uint8Array.from(out)
}

/** PNG: лишаємо тільки критичні чанки, викидаємо eXIf/tEXt/iTXt/zTXt/tIME. */
function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'])
  const out: number[] = []
  for (let i = 0; i < 8; i++) out.push(bytes[i])
  let i = 8
  while (i + 8 <= bytes.length) {
    const length = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])
    const total = 12 + length
    if (!DROP.has(type)) {
      for (let j = i; j < i + total && j < bytes.length; j++) out.push(bytes[j])
    }
    if (type === 'IEND') break
    i += total
  }
  return Uint8Array.from(out)
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}
