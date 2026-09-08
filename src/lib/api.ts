import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { getUserId, assertCsrf, CsrfError, rateLimit } from '@/lib/session'
import { logEvent } from '@/lib/mcp/pii'
import { ConfirmationRequiredError } from '@/lib/agent/tools'

/** Спільна обгортка route handler-ів: сесія, CSRF, rate limit, помилки. */

/**
 * Свідома відмова користувачу, а не збій.
 *
 * «Спершу приготуйте цей рецепт» — правило продукту, і воно спрацьовує
 * штатно щоразу, коли хтось тисне голос не в тому порядку. Доти такі
 * випадки летіли як `api.unhandled` рівнем error і з кодом 500: лог
 * помилок наповнювався нормальною поведінкою, а справжній збій у ньому
 * було вже не знайти.
 */
export class RefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefusedError'
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Потрібна авторизація або demo-режим')
    this.name = 'UnauthorizedError'
  }
}

export async function requireUserId(): Promise<string> {
  const userId = await getUserId()
  if (!userId) throw new UnauthorizedError()
  return userId
}

interface HandlerOptions {
  /** мутуючий запит: перевіряємо CSRF */
  mutating?: boolean
  /** окремий ліміт для важких операцій (наприклад, розпізнавання фото) */
  rateLimitPerMinute?: number
  rateLimitKey?: string
}

export async function handle<T>(
  request: Request,
  options: HandlerOptions,
  fn: (userId: string) => Promise<T>,
): Promise<NextResponse> {
  try {
    const userId = await requireUserId()
    if (options.mutating) await assertCsrf(request)
    if (options.rateLimitPerMinute) {
      const key = `${options.rateLimitKey ?? new URL(request.url).pathname}:${userId}`
      if (!rateLimit(key, options.rateLimitPerMinute)) {
        return NextResponse.json({ error: 'Забагато запитів. Спробуйте за хвилину.' }, { status: 429 })
      }
    }
    const data = await fn(userId)
    return NextResponse.json(data)
  } catch (err) {
    return errorResponse(err)
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: err.message, code: 'unauthorized' }, { status: 401 })
  }
  if (err instanceof CsrfError) {
    return NextResponse.json({ error: err.message, code: 'csrf' }, { status: 403 })
  }
  if (err instanceof ConfirmationRequiredError) {
    return NextResponse.json({ error: err.message, code: 'confirmation_required' }, { status: 409 })
  }
  if (err instanceof RefusedError) {
    return NextResponse.json({ error: err.message, code: 'refused' }, { status: 409 })
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: 'Некоректні дані', code: 'validation', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      { status: 422 },
    )
  }
  const message = err instanceof Error ? err.message : 'Невідома помилка'
  logEvent('error', 'api.unhandled', { message })
  return NextResponse.json({ error: message }, { status: 500 })
}
