/**
 * Штрихкоди EAN-13 / EAN-8.
 *
 * Навіщо це в домені, а не в компоненті: контрольна сума — єдиний спосіб
 * відрізнити справжній штрихкод від випадкових цифр, які видала камера.
 * Без перевірки застосунок шукав би в каталозі «Сільпо» неіснуючий товар
 * і показував користувачу порожній результат замість «спробуйте ще раз».
 */

export type BarcodeFormat = 'ean13' | 'ean8'

export interface ParsedBarcode {
  code: string
  format: BarcodeFormat
  /** GS1-префікс країни, якщо його вдалося визначити */
  countryHint?: string
}

/** Українські GS1-префікси. Не гарантія походження, лише підказка. */
const GS1_PREFIXES: { range: [number, number]; label: string }[] = [
  { range: [482, 482], label: 'Україна' },
  { range: [400, 440], label: 'Німеччина' },
  { range: [460, 469], label: 'росія' },
  { range: [590, 590], label: 'Польща' },
  { range: [800, 839], label: 'Італія' },
  { range: [869, 869], label: 'Туреччина' },
  { range: [30, 37], label: 'Франція' },
  { range: [50, 50], label: 'Велика Британія' },
]

/**
 * Контрольна цифра EAN: зважена сума решти цифр.
 * Ваги чергуються 1/3, рахуються справа наліво від контрольної.
 */
export function eanCheckDigit(digitsWithoutCheck: string): number {
  const digits = digitsWithoutCheck.split('').map(Number)
  let sum = 0
  // справа наліво: перша цифра має вагу 3, далі чергуємо
  for (let i = digits.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += digits[i] * weight
  }
  return (10 - (sum % 10)) % 10
}

export function isValidEan(code: string): boolean {
  if (!/^\d{8}$|^\d{13}$/.test(code)) return false
  const body = code.slice(0, -1)
  const check = Number(code.slice(-1))
  return eanCheckDigit(body) === check
}

/**
 * Розбирає рядок зі сканера. Повертає null для будь-чого, що не пройшло
 * перевірку контрольної суми — краще попросити повторити, ніж шукати сміття.
 */
export function parseBarcode(raw: string): ParsedBarcode | null {
  const code = raw.replace(/\D/g, '')
  if (!isValidEan(code)) return null
  const format: BarcodeFormat = code.length === 13 ? 'ean13' : 'ean8'
  return { code, format, countryHint: format === 'ean13' ? countryFor(code) : undefined }
}

function countryFor(code: string): string | undefined {
  const three = Number(code.slice(0, 3))
  const two = Number(code.slice(0, 2))
  for (const entry of GS1_PREFIXES) {
    const [from, to] = entry.range
    if (from >= 100 && three >= from && three <= to) return entry.label
    if (from < 100 && two >= from && two <= to) return entry.label
  }
  return undefined
}

/**
 * Генерує валідний EAN-13 із 12 цифр — потрібно для тестів і для
 * демонстраційного режиму, де справжнього сканера немає.
 */
export function completeEan13(twelveDigits: string): string | null {
  if (!/^\d{12}$/.test(twelveDigits)) return null
  return twelveDigits + eanCheckDigit(twelveDigits)
}
