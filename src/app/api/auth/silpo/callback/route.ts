import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { config, oauthRedirectUri } from '@/lib/config'
import { exchangeCodeForToken } from '@/lib/mcp/oauth'
import { setSession, takeOAuthPending, getUserId } from '@/lib/session'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Повернення з «Сільпо». Обмінюємо code на токен і зберігаємо його
 * ВИКЛЮЧНО на сервері (таблиця McpSession). У браузер їде лише
 * підписана сесійна кука з userId.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const fail = (message: string) =>
    NextResponse.redirect(`${config.appBaseUrl}/login?error=${encodeURIComponent(message)}`)

  if (error) return fail(`«Сільпо» повернув помилку: ${error}`)
  if (!code || !state) return fail('Відповідь авторизації неповна')

  const pending = await takeOAuthPending()
  if (!pending) return fail('Сесія авторизації застаріла — спробуйте ще раз')
  // Захист від CSRF на етапі OAuth
  if (pending.state !== state) return fail('Невідповідність state — авторизацію відхилено')

  try {
    const tokens = await exchangeCodeForToken({
      metadata: {
        issuer: pending.issuer,
        authorization_endpoint: pending.authorizationEndpoint,
        token_endpoint: pending.tokenEndpoint,
      },
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      redirectUri: oauthRedirectUri(),
      code,
      codeVerifier: pending.verifier,
      resource: config.silpo.mcpUrl,
    })

    // Прив'язуємо до поточної сесії, якщо вона є, інакше створюємо користувача
    const existingUserId = await getUserId()
    const user = existingUserId
      ? await prisma.user.update({ where: { id: existingUserId }, data: { authMode: 'silpo' } })
      : await prisma.user.create({ data: { displayName: 'Гість «Сільпо»', authMode: 'silpo' } })

    await prisma.mcpSession.deleteMany({ where: { userId: user.id } })
    await prisma.mcpSession.create({
      data: {
        userId: user.id,
        clientId: pending.clientId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      },
    })
    await setSession(user.id)

    logEvent('info', 'auth.oauth_success', { userRef: user.id.slice(0, 4) })
    // Після входу одразу пропонуємо підтягнути профіль і чеки
    return NextResponse.redirect(`${config.appBaseUrl}/onboarding?source=silpo`)
  } catch (err) {
    logEvent('error', 'auth.oauth_callback_failed', { message: err instanceof Error ? err.message : String(err) })
    return fail(err instanceof Error ? err.message : 'Не вдалося завершити авторизацію')
  }
}
