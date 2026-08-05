import { request } from '@playwright/test'

/**
 * Прогрів dev-сервера.
 *
 * Next компілює маршрути на першому запиті, і холодна компіляція «/» іноді
 * перевищує таймаут очікування в тесті. Це не дефект продукту, але робить
 * набір флакі: щоразу падав інший тест — той, який першим зачепив новий роут.
 * Тому перед прогоном один раз проходимось по всіх сторінках.
 */
const ROUTES = ['/login', '/', '/pantry', '/scan', '/recipes', '/cart', '/trace', '/onboarding', '/dish?query=Тірамісу']

export default async function globalSetup() {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3210'
  const ctx = await request.newContext({ baseURL })

  // сесія потрібна, щоб сторінки за авторизацією теж скомпілювались
  await ctx.post('/api/auth/demo').catch(() => undefined)

  const started = Date.now()
  for (const route of ROUTES) {
    await ctx.get(route, { timeout: 120_000 }).catch(() => undefined)
  }
  await ctx.dispose()
  console.log(`[global-setup] прогріто ${ROUTES.length} маршрутів за ${Date.now() - started} мс`)
}
