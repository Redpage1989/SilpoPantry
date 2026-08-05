import { NextResponse } from 'next/server'
import { config, oauthRedirectUri } from '@/lib/config'
import { buildAuthorizationUrl, createPkcePair, discoverAuthServer, randomState, registerClient } from '@/lib/mcp/oauth'
import { setOAuthPending } from '@/lib/session'
import { logEvent } from '@/lib/mcp/pii'

/**
 * Початок OAuth 2.1 з «Сільпо».
 *
 * 1. Discovery: дізнаємось endpoints із .well-known.
 * 2. Якщо SILPO_CLIENT_ID не заданий — реєструємо клієнта динамічно.
 *    Саме тому в репозиторії немає жодного client_id чи секрету.
 * 3. Генеруємо PKCE S256 + state, кладемо їх у httpOnly куку на 10 хв.
 * 4. Редіректимо користувача на сторінку авторизації «Сільпо».
 */
export async function GET() {
  try {
    const redirectUri = oauthRedirectUri()
    const metadata = await discoverAuthServer(config.silpo.mcpUrl)

    let clientId = config.silpo.clientId
    let clientSecret = config.silpo.clientSecret || undefined
    if (!clientId) {
      const registered = await registerClient(metadata, redirectUri)
      clientId = registered.client_id
      clientSecret = registered.client_secret
    }

    const { verifier, challenge } = createPkcePair()
    const state = randomState()

    await setOAuthPending({
      state,
      verifier,
      clientId,
      clientSecret,
      tokenEndpoint: metadata.token_endpoint,
      authorizationEndpoint: metadata.authorization_endpoint,
      issuer: metadata.issuer,
    })

    const url = buildAuthorizationUrl({
      metadata,
      clientId,
      redirectUri,
      state,
      codeChallenge: challenge,
      resource: config.silpo.mcpUrl,
    })

    logEvent('info', 'auth.oauth_start', { issuer: metadata.issuer })
    return NextResponse.redirect(url)
  } catch (err) {
    logEvent('error', 'auth.oauth_start_failed', { message: err instanceof Error ? err.message : String(err) })
    const message = encodeURIComponent(err instanceof Error ? err.message : 'Помилка авторизації')
    return NextResponse.redirect(`${config.appBaseUrl}/login?error=${message}`)
  }
}
