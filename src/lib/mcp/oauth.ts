import { createHash, randomBytes } from 'node:crypto'
import { logEvent } from './pii'

/**
 * OAuth 2.1 Authorization Code + PKCE + Dynamic Client Registration
 * для офіційного MCP «Сільпо».
 *
 * Перевірено на живому сервері (див. PLAN.md §1):
 *   /.well-known/oauth-protected-resource/mcp → authorization_servers
 *   /.well-known/oauth-authorization-server   → /authorize, /token, /register
 *   code_challenge_methods_supported: ["plain","S256"] → використовуємо S256
 *
 * Завдяки DCR у репозиторії не потрібен жоден client_id — застосунок
 * реєструє себе сам при першому вході. Це і вимога хакатону («без секретів
 * у репозиторії»), і просто менше ручної роботи.
 */

export interface AuthServerMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  code_challenge_methods_supported?: string[]
  grant_types_supported?: string[]
  token_endpoint_auth_methods_supported?: string[]
}

export interface RegisteredClient {
  client_id: string
  client_secret?: string
  client_id_issued_at?: number
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt: Date
  scope?: string
}

const DISCOVERY_TIMEOUT = 15_000

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
    return JSON.parse(text) as T
  } finally {
    clearTimeout(timer)
  }
}

/** Крок 1: дізнаємось, який сервер авторизації захищає цей MCP-ресурс. */
export async function discoverAuthServer(mcpUrl: string): Promise<AuthServerMetadata> {
  const url = new URL(mcpUrl)
  const resourceMetaUrl = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`

  let issuerBase = url.origin
  try {
    const meta = await getJson<{ authorization_servers?: string[] }>(resourceMetaUrl)
    if (meta.authorization_servers?.[0]) issuerBase = meta.authorization_servers[0].replace(/\/$/, '')
  } catch {
    // деякі сервери не публікують protected-resource — падаємо назад на origin
    logEvent('warn', 'oauth.protected_resource_missing', { resourceMetaUrl })
  }

  // RFC 8414 допускає обидва варіанти розташування метаданих
  const candidates = [
    `${issuerBase}/.well-known/oauth-authorization-server`,
    `${issuerBase}/.well-known/openid-configuration`,
  ]
  for (const candidate of candidates) {
    try {
      const meta = await getJson<AuthServerMetadata>(candidate)
      if (meta.authorization_endpoint && meta.token_endpoint) {
        logEvent('info', 'oauth.discovered', { issuer: meta.issuer, hasDcr: !!meta.registration_endpoint })
        return meta
      }
    } catch {
      /* пробуємо наступний */
    }
  }
  throw new Error(`Не вдалося отримати метадані сервера авторизації для ${mcpUrl}`)
}

/** Крок 2: реєструємо клієнта динамічно, якщо client_id не заданий у env. */
export async function registerClient(
  metadata: AuthServerMetadata,
  redirectUri: string,
): Promise<RegisteredClient> {
  if (!metadata.registration_endpoint) {
    throw new Error('Сервер не підтримує Dynamic Client Registration — задайте SILPO_CLIENT_ID у .env')
  }
  const body = {
    client_name: 'Сільпо: Сімейна комора (hackathon prototype)',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // публічний клієнт, секрет не зберігаємо
    application_type: 'web',
  }
  const client = await getJson<RegisteredClient>(metadata.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  logEvent('info', 'oauth.client_registered', { hasSecret: !!client.client_secret })
  return client
}

export interface PkcePair {
  verifier: string
  challenge: string
}

/** PKCE S256 — plain не використовуємо, хоча сервер його й допускає. */
export function createPkcePair(): PkcePair {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function randomState(): string {
  return base64url(randomBytes(24))
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Крок 3: посилання, на яке ведемо користувача. */
export function buildAuthorizationUrl(params: {
  metadata: AuthServerMetadata
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  resource: string
  scope?: string
}): string {
  const url = new URL(params.metadata.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  // RFC 8707: прив'язуємо токен саме до цього MCP-ресурсу
  url.searchParams.set('resource', params.resource)
  if (params.scope) url.searchParams.set('scope', params.scope)
  return url.toString()
}

/** Крок 4: обмін code → token. */
export async function exchangeCodeForToken(params: {
  metadata: AuthServerMetadata
  clientId: string
  clientSecret?: string
  redirectUri: string
  code: string
  codeVerifier: string
  resource: string
}): Promise<TokenSet> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  })
  if (params.clientSecret) form.set('client_secret', params.clientSecret)

  const token = await getJson<{
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }>(params.metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })

  logEvent('info', 'oauth.token_issued', { hasRefresh: !!token.refresh_token, expiresIn: token.expires_in })
  return toTokenSet(token)
}

export async function refreshAccessToken(params: {
  metadata: AuthServerMetadata
  clientId: string
  clientSecret?: string
  refreshToken: string
  resource: string
}): Promise<TokenSet> {
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    resource: params.resource,
  })
  if (params.clientSecret) form.set('client_secret', params.clientSecret)

  const token = await getJson<{
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }>(params.metadata.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  logEvent('info', 'oauth.token_refreshed', {})
  return { ...toTokenSet(token), refreshToken: token.refresh_token ?? params.refreshToken }
}

function toTokenSet(token: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }): TokenSet {
  const ttl = token.expires_in ?? 3600
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    // мінус хвилина запасу, щоб не впертися в закінчення посеред запиту
    expiresAt: new Date(Date.now() + Math.max(60, ttl - 60) * 1000),
    scope: token.scope,
  }
}

export function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now()
}
