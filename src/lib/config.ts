/**
 * Уся робота з env — в одному місці, з явними дефолтами.
 * Жодне з цих значень не потрапляє в клієнтський бандл:
 * файл імпортується лише серверним кодом.
 */

function str(key: string, fallback = ''): string {
  return process.env[key]?.trim() || fallback
}

function num(key: string, fallback: number): number {
  const raw = process.env[key]
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  appBaseUrl: str('APP_BASE_URL', 'http://localhost:3210'),
  sessionSecret: str('SESSION_SECRET'),

  silpo: {
    mcpUrl: str('SILPO_MCP_URL', 'https://mcp.silpo.ua/mcp'),
    clientId: str('SILPO_CLIENT_ID'),
    clientSecret: str('SILPO_CLIENT_SECRET'),
    /** auto | live | mock */
    mode: str('SILPO_MCP_MODE', 'auto') as 'auto' | 'live' | 'mock',
  },

  anthropic: {
    apiKey: str('ANTHROPIC_API_KEY'),
    visionModel: str('ANTHROPIC_VISION_MODEL', 'claude-opus-5'),
  },

  limits: {
    maxUploadBytes: num('MAX_UPLOAD_MB', 8) * 1024 * 1024,
    ratePerMinute: num('RATE_LIMIT_PER_MINUTE', 30),
    photoTtlMinutes: num('PHOTO_TTL_MINUTES', 30),
  },
} as const

export function oauthRedirectUri(): string {
  return `${config.appBaseUrl.replace(/\/$/, '')}/api/auth/silpo/callback`
}

/** Чи налаштований AI-аналіз фото по-справжньому. */
export function hasVisionKey(): boolean {
  return config.anthropic.apiKey.length > 0
}
