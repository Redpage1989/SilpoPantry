import { describe, it, expect } from 'vitest'
import { eanCheckDigit, isValidEan, parseBarcode, completeEan13 } from '@/lib/domain/barcode'

/**
 * Контрольні суми звірені з реальними штрихкодами:
 * 4820000000017 — український префікс 482
 * 5901234123457 — канонічний приклад EAN-13 зі специфікації GS1
 * 96385074       — канонічний приклад EAN-8
 */

describe('контрольна цифра EAN', () => {
  it('рахує правильно для відомих кодів', () => {
    expect(eanCheckDigit('590123412345')).toBe(7)
    expect(eanCheckDigit('9638507')).toBe(4)
  })

  it('доповнює 12 цифр до валідного EAN-13', () => {
    const full = completeEan13('590123412345')
    expect(full).toBe('5901234123457')
    expect(isValidEan(full!)).toBe(true)
  })

  it('відмовляється доповнювати некоректний ввід', () => {
    expect(completeEan13('12345')).toBeNull()
    expect(completeEan13('abcdefghijkl')).toBeNull()
  })
})

describe('валідація штрихкоду', () => {
  it('приймає валідні EAN-13 і EAN-8', () => {
    expect(isValidEan('5901234123457')).toBe(true)
    expect(isValidEan('96385074')).toBe(true)
  })

  it('відхиляє код із помилковою контрольною цифрою', () => {
    // саме це відрізняє реальний скан від помилки розпізнавання камери
    expect(isValidEan('5901234123458')).toBe(false)
    expect(isValidEan('96385075')).toBe(false)
  })

  it('відхиляє неправильну довжину й нецифрові символи', () => {
    expect(isValidEan('123')).toBe(false)
    expect(isValidEan('12345678901234')).toBe(false)
    expect(isValidEan('590123412345X')).toBe(false)
  })
})

describe('розбір результату сканера', () => {
  it('чистить сміттєві символи навколо коду', () => {
    expect(parseBarcode('  5901234123457\n')?.code).toBe('5901234123457')
  })

  it('повертає null замість того, щоб шукати сміття в каталозі', () => {
    expect(parseBarcode('не штрихкод')).toBeNull()
    expect(parseBarcode('5901234123458')).toBeNull()
  })

  it('визначає формат', () => {
    expect(parseBarcode('5901234123457')?.format).toBe('ean13')
    expect(parseBarcode('96385074')?.format).toBe('ean8')
  })

  it('підказує країну за GS1-префіксом', () => {
    const ua = completeEan13('482000000001')!
    expect(parseBarcode(ua)?.countryHint).toBe('Україна')
    expect(parseBarcode('5901234123457')?.countryHint).toBe('Польща')
  })

  it('не вигадує країну для невідомого префікса', () => {
    const unknown = completeEan13('999000000001')!
    expect(parseBarcode(unknown)?.countryHint).toBeUndefined()
  })
})
