/**
 * Діагностика MCP «Сільпо» без запуску застосунку.
 *
 *   npm run mcp:probe
 *
 * Перевіряє discovery, наявність Dynamic Client Registration і реакцію
 * на запит без токена. Нічого не змінює й нічого не зберігає.
 * Виводить лише публічні метадані — жодних секретів.
 */

const MCP_URL = process.env.SILPO_MCP_URL?.trim() || 'https://mcp.silpo.ua/mcp'

async function main() {
  console.log(`\n🔎 Перевіряю ${MCP_URL}\n`)

  const url = new URL(MCP_URL)

  // 1. Захищений ресурс
  const prUrl = `${url.origin}/.well-known/oauth-protected-resource${url.pathname}`
  const pr = await safeJson(prUrl)
  if (pr.ok) {
    console.log('✅ oauth-protected-resource')
    console.log(`   authorization_servers: ${JSON.stringify(pr.data?.authorization_servers)}`)
  } else {
    console.log(`⚠️  oauth-protected-resource недоступний: ${pr.error}`)
  }

  // 2. Метадані сервера авторизації
  const servers = pr.data?.authorization_servers
  const firstServer = Array.isArray(servers) ? String(servers[0]) : undefined
  const issuer = firstServer?.replace(/\/$/, '') ?? url.origin
  const asUrl = `${issuer}/.well-known/oauth-authorization-server`
  const as = await safeJson(asUrl)
  if (as.ok) {
    console.log('✅ oauth-authorization-server')
    console.log(`   authorization_endpoint: ${as.data?.authorization_endpoint}`)
    console.log(`   token_endpoint:         ${as.data?.token_endpoint}`)
    console.log(`   registration_endpoint:  ${as.data?.registration_endpoint ?? '— (DCR немає)'}`)
    console.log(`   PKCE methods:           ${JSON.stringify(as.data?.code_challenge_methods_supported)}`)
    console.log(`   grant_types:            ${JSON.stringify(as.data?.grant_types_supported)}`)
  } else {
    console.log(`❌ oauth-authorization-server недоступний: ${as.error}`)
  }

  // 3. Реакція на запит без токена
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'silpo-pantry-probe', version: '0.1.0' } },
    }),
  }).catch((e) => ({ status: 0, headers: new Headers(), statusText: String(e) }) as Response)

  console.log(`\n📡 POST без токена → HTTP ${res.status}`)
  const wwwAuth = res.headers.get('www-authenticate')
  if (res.status === 401) {
    console.log('   ✅ Очікувано: ресурс закритий Bearer-токеном')
    if (wwwAuth) console.log(`   WWW-Authenticate: ${wwwAuth.slice(0, 160)}`)
  }

  console.log(`
📋 Висновок
   • Живий MCP-виклик потребує інтерактивного входу користувача.
   • Запустіть застосунок і пройдіть «Увійти через «Сільпо»» на /trace.
   • ${as.data?.registration_endpoint ? 'DCR підтримується — client_id у .env не потрібен.' : 'DCR немає — задайте SILPO_CLIENT_ID у .env.'}
`)
}

async function safeJson(u: string): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const res = await fetch(u, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true, data: (await res.json()) as Record<string, unknown> }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
