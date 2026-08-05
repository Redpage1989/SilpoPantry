'use client'

/** Тонкий клієнт до власного API: додає CSRF-заголовок і однаково обробляє помилки. */

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)sp_csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  if (!res.ok) {
    throw new ApiError(
      (data.error as string) ?? `Помилка ${res.status}`,
      res.status,
      data.code as string | undefined,
    )
  }
  return data as T
}

export async function apiGet<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: 'no-store' }))
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

export async function apiPut<T>(url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

export async function apiDelete<T>(url: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

export async function apiUpload<T>(url: string, form: FormData): Promise<T> {
  return parse<T>(
    await fetch(url, { method: 'POST', headers: { 'x-csrf-token': csrfToken() }, body: form }),
  )
}
