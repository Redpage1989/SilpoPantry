import { prisma } from '@/lib/db'
import { config } from '@/lib/config'
import { McpHttpClient } from './client'
import { LiveSilpoAdapter } from './live-adapter'
import { MockSilpoAdapter } from './mock-adapter'
import { discoverAuthServer, isExpired, refreshAccessToken } from './oauth'
import { logEvent } from './pii'
import type { SilpoAdapter } from './types'

export * from './types'
export { MockSilpoAdapter } from './mock-adapter'
export { LiveSilpoAdapter, ToolUnavailableError } from './live-adapter'

export interface AdapterResolution {
  adapter: SilpoAdapter
  /** чому обрано саме цей режим — показуємо в UI, а не ховаємо */
  reason: string
  /** чи можна перейти в live (є куди логінитись) */
  canGoLive: boolean
}

/**
 * Вибір адаптера — єдина точка, де вирішується live vs demo.
 *
 * Порядок:
 *   SILPO_MCP_MODE=mock          → завжди demo
 *   немає валідного токена       → demo (з поясненням «увійдіть через Сільпо»)
 *   токен протух, є refresh      → оновлюємо і йдемо live
 *   SILPO_MCP_MODE=live без токена → кидаємо помилку, а не мовчазний mock
 */
export async function resolveAdapter(userId: string): Promise<AdapterResolution> {
  if (config.silpo.mode === 'mock') {
    return { adapter: new MockSilpoAdapter(userId), reason: 'SILPO_MCP_MODE=mock — примусовий demo-режим', canGoLive: false }
  }

  const session = await prisma.mcpSession.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })

  if (!session) {
    if (config.silpo.mode === 'live') {
      throw new Error('SILPO_MCP_MODE=live, але немає авторизованої MCP-сесії. Увійдіть через «Сільпо».')
    }
    return {
      adapter: new MockSilpoAdapter(userId),
      reason: 'Немає авторизації в «Сільпо» — працюємо на демо-даних',
      canGoLive: true,
    }
  }

  let accessToken = session.accessToken
  if (isExpired(session.expiresAt)) {
    if (!session.refreshToken) {
      return {
        adapter: new MockSilpoAdapter(userId),
        reason: 'Термін дії токена «Сільпо» минув — увійдіть знову',
        canGoLive: true,
      }
    }
    try {
      const metadata = await discoverAuthServer(config.silpo.mcpUrl)
      const refreshed = await refreshAccessToken({
        metadata,
        clientId: session.clientId,
        clientSecret: config.silpo.clientSecret || undefined,
        refreshToken: session.refreshToken,
        resource: config.silpo.mcpUrl,
      })
      await prisma.mcpSession.update({
        where: { id: session.id },
        data: {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken ?? session.refreshToken,
          expiresAt: refreshed.expiresAt,
        },
      })
      accessToken = refreshed.accessToken
    } catch (err) {
      logEvent('warn', 'mcp.refresh_failed', { message: err instanceof Error ? err.message : String(err) })
      return {
        adapter: new MockSilpoAdapter(userId),
        reason: 'Не вдалося оновити токен «Сільпо» — демо-режим',
        canGoLive: true,
      }
    }
  }

  const client = new McpHttpClient({ url: config.silpo.mcpUrl, accessToken })
  return {
    adapter: new LiveSilpoAdapter(client),
    reason: 'Живе зʼєднання з офіційним MCP «Сільпо»',
    canGoLive: false,
  }
}

/**
 * Обгортка на випадок, коли live-виклик падає посеред сценарію:
 * повертаємо demo-адаптер, але НЕ вдаємо, що дані справжні.
 */
export async function resolveAdapterSafe(userId: string): Promise<AdapterResolution> {
  try {
    return await resolveAdapter(userId)
  } catch (err) {
    logEvent('warn', 'mcp.resolve_failed', { message: err instanceof Error ? err.message : String(err) })
    return {
      adapter: new MockSilpoAdapter(userId),
      reason: `Помилка підключення до MCP: ${err instanceof Error ? err.message : 'невідома'}`,
      canGoLive: true,
    }
  }
}
