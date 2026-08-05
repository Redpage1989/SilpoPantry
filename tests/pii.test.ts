import { describe, it, expect } from 'vitest'
import { sanitizeForTrace, maskString, maskTail, shortenId } from '@/lib/mcp/pii'

/**
 * Тести написані на РЕАЛЬНИХ формах відповідей MCP «Сільпо»,
 * знятих через `npm run mcp:inspect --call`. Значення замінено на вигадані.
 */

describe('маскування рядків', () => {
  it('ховає email, телефон і довгі токени', () => {
    expect(maskString('пишіть на test.user@example.com')).toContain('«email приховано»')
    expect(maskString('телефон +380671234567')).toContain('«телефон приховано»')
    expect(maskString('Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH')).toContain('«токен приховано»')
  })

  it('показує лише хвіст картки', () => {
    expect(maskTail('1234567890124821')).toBe('•••• 4821')
    expect(maskTail('12')).toBe('••••')
  })

  it('скорочує технічні ідентифікатори', () => {
    expect(shortenId('c0d0fddb-aac2-4910-9e3b-ee641f10e87d')).toBe('c0d0…7d')
  })
})

describe('sanitizeForTrace на реальних формах відповідей', () => {
  it('профіль: ховає імʼя, телефон, email, дату народження і стать', () => {
    const profile = {
      success: true,
      profile: {
        id: 'c0d0fddb-aac2-4910-9e3b-ee641f10e87d',
        firstName: 'Антон',
        lastName: 'Прізвище',
        middleName: 'По батькові',
        phone: '+380671234567',
        email: 'user@example.com',
        birthday: '1989-11-14',
        gender: 'male',
        status: 'Active',
      },
    }
    const json = JSON.stringify(sanitizeForTrace(profile))
    for (const leak of ['Антон', 'Прізвище', 'По батькові', '380671234567', 'user@example.com', '1989-11-14', 'male']) {
      expect(json, `просочилось: ${leak}`).not.toContain(leak)
    }
    // нечутливе лишається — інакше трейс стає марним
    expect(json).toContain('Active')
  })

  it('родина: ховає повне імʼя члена родини та фото профілю', () => {
    const family = {
      success: true,
      name: 'Моя сімʼя',
      members: [
        {
          profileId: 'c0d0fddb-aac2-4910-9e3b-ee641f10e87d',
          name: 'Антон Прізвище',
          phone: '+380671234567',
          image: 'https://images.silpo.ua/v2/profile/200x200/origin/ee369ca7-1c1b.jpg',
          itsMe: true,
        },
      ],
    }
    const json = JSON.stringify(sanitizeForTrace(family))
    expect(json).not.toContain('Антон Прізвище')
    expect(json).not.toContain('380671234567')
    expect(json).not.toContain('images.silpo.ua')
  })

  it('назви товарів НЕ маскуються — інакше трейс нечитабельний', () => {
    const products = {
      success: true,
      products: [
        { id: 'p1', name: 'Сир Маскарпоне 78%, 250 г', price: 129, title: 'Маскарпоне' },
        { id: 'p2', name: 'Печиво Савоярді, 200 г', price: 79 },
      ],
    }
    const json = JSON.stringify(sanitizeForTrace(products))
    expect(json).toContain('Маскарпоне')
    expect(json).toContain('Савоярді')
  })

  it('лояльність: ховає номер картки, лишає баланс', () => {
    const loyalty = {
      success: true,
      loyalty: { card: '1234567890124821', balance: { total: 1240, currency: 'UAH' } },
    }
    const json = JSON.stringify(sanitizeForTrace(loyalty))
    expect(json).not.toContain('1234567890124821')
    expect(json).toContain('1240')
  })

  it('ховає токени на будь-якій глибині вкладеності', () => {
    const nested = { a: { b: { c: { d: { access_token: 'super-secret-value' } } } } }
    expect(JSON.stringify(sanitizeForTrace(nested))).not.toContain('super-secret-value')
  })

  it('обрізає великі масиви й довгі рядки', () => {
    const big = { items: Array.from({ length: 50 }, (_, i) => `товар ${i}`), text: 'я'.repeat(1000) }
    const out = sanitizeForTrace(big) as { items: unknown[]; text: string }
    expect(out.items.length).toBeLessThanOrEqual(21)
    expect(out.text.length).toBeLessThanOrEqual(401)
  })

  it('не падає на null, undefined і примітивах', () => {
    expect(sanitizeForTrace(null)).toBeNull()
    expect(sanitizeForTrace(undefined)).toBeUndefined()
    expect(sanitizeForTrace(42)).toBe(42)
    expect(sanitizeForTrace(true)).toBe(true)
  })
})
