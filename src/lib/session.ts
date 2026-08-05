import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'
import { config } from '@/lib/config'

/**
 * Сесії. Куки httpOnly + secure + SameSite=Lax, підписані HMAC.
 * У куці лежить лише userId — жодних токенів «Сільпо»: вони живуть
 * у таблиці McpSession на сервері й у браузер не потрапляють ніколи.
 */

const SESSION_COOKIE = 'sp_session'
const CSRF_COOKIE = 'sp_csrf'
const OAUTH_COOKIE = 'sp_oauth'
const MAX_AGE = 60 * 60 * 24 * 30

function secret(): string {
  if (!config.sessionSecret) {
    // у dev краще працювати з тимчасовим ключем, ніж падати на першому запиті
    return 'dev-only-insecure-secret-change-me'
  }
  return config.sessionSecret
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

function pack(value: string): string {
  return `${value}.${sign(value)}`
}

function unpack(packed: string | undefined): string | null {
  if (!packed) return null
  const idx = packed.lastIndexOf('.')
  if (idx <= 0) return null
  const value = packed.slice(0, idx)
  const mac = packed.slice(idx + 1)
  const expected = sign(value)
  if (mac.length !== expected.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null
  } catch {
    return null
  }
  return value
}

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE,
}

export async function setSession(userId: string): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, pack(userId), cookieOptions)
  // CSRF-токен навмисно доступний зі скрипта: клієнт має покласти його в заголовок
  jar.set(CSRF_COOKIE, randomBytes(24).toString('base64url'), { ...cookieOptions, httpOnly: false })
}

export async function clearSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
  jar.delete(CSRF_COOKIE)
  jar.delete(OAUTH_COOKIE)
}

export async function getUserId(): Promise<string | null> {
  const jar = await cookies()
  return unpack(jar.get(SESSION_COOKIE)?.value)
}

/** Повертає користувача або null. Не створює нічого сам. */
export async function getCurrentUser() {
  const userId = await getUserId()
  if (!userId) return null
  return prisma.user.findUnique({
    where: { id: userId },
    include: { members: true, restrictions: true },
  })
}

/**
 * Double-submit CSRF: значення з куки має збігтися із заголовком.
 * Захищає всі мутуючі запити, включно з write-операціями в кошик.
 */
export async function assertCsrf(request: Request): Promise<void> {
  const jar = await cookies()
  const cookieToken = jar.get(CSRF_COOKIE)?.value
  const headerToken = request.headers.get('x-csrf-token')
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw new CsrfError()
  }
}

export class CsrfError extends Error {
  constructor() {
    super('Невалідний CSRF-токен')
    this.name = 'CsrfError'
  }
}

// ── тимчасове сховище OAuth-стану (state + PKCE verifier) ─────────────
// Живе у httpOnly куці 10 хвилин: сервер stateless, а класти verifier
// у БД заради 10 хвилин — зайве.

export interface OAuthPending {
  state: string
  verifier: string
  clientId: string
  clientSecret?: string
  tokenEndpoint: string
  authorizationEndpoint: string
  issuer: string
}

export async function setOAuthPending(data: OAuthPending): Promise<void> {
  const jar = await cookies()
  jar.set(OAUTH_COOKIE, pack(Buffer.from(JSON.stringify(data)).toString('base64url')), {
    ...cookieOptions,
    maxAge: 600,
  })
}

export async function takeOAuthPending(): Promise<OAuthPending | null> {
  const jar = await cookies()
  const raw = unpack(jar.get(OAUTH_COOKIE)?.value)
  jar.delete(OAUTH_COOKIE)
  if (!raw) return null
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OAuthPending
  } catch {
    return null
  }
}

// ── простий rate limiting у памʼяті процесу ──────────────────────────
// Для прототипу достатньо; у продакшні це має бути Redis.

const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, limit = config.limits.ratePerMinute): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (bucket.count >= limit) return false
  bucket.count += 1
  return true
}
