import { logEvent } from './pii'

/**
 * Мінімальний клієнт MCP over Streamable HTTP.
 *
 * Чому свій, а не @modelcontextprotocol/sdk: нам потрібні рівно три речі —
 * initialize, tools/list і tools/call — плюс повний контроль над заголовком
 * Authorization і над тим, що саме потрапляє в лог. Свої 150 рядків тут
 * прозоріші за залежність, і їх можна показати журі цілком.
 *
 * Сервер може відповідати як `application/json`, так і `text/event-stream` —
 * підтримуємо обидва, як вимагає специфікація Streamable HTTP.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18'

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly httpStatus?: number,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'McpError'
  }
}

/** 401 від MCP означає «потрібна авторизація», а не «щось зламалось». */
export class McpUnauthorizedError extends McpError {
  constructor(
    message: string,
    readonly resourceMetadataUrl?: string,
  ) {
    super(message, -32001, 401)
    this.name = 'McpUnauthorizedError'
  }
}

export interface McpToolDefinition {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpCallResult {
  content: { type: string; text?: string; [k: string]: unknown }[]
  isError?: boolean
  structuredContent?: unknown
}

interface ClientOptions {
  url: string
  accessToken?: string
  timeoutMs?: number
}

export class McpHttpClient {
  private sessionId: string | null = null
  private nextId = 1
  private initialized = false

  constructor(private readonly options: ClientOptions) {}

  private get timeout(): number {
    return this.options.timeoutMs ?? 20_000
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
    }
    if (this.options.accessToken) h.Authorization = `Bearer ${this.options.accessToken}`
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId
    return h
  }

  private async rpc<T>(method: string, params?: unknown, isNotification = false): Promise<T> {
    const body = isNotification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: this.nextId++, method, params }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)

    let res: Response
    try {
      res = await fetch(this.options.url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      })
    } catch (err) {
      clearTimeout(timer)
      const message = err instanceof Error && err.name === 'AbortError' ? `Таймаут ${this.timeout} мс` : String(err)
      throw new McpError(`Мережева помилка MCP: ${message}`, -32000)
    }
    clearTimeout(timer)

    const newSession = res.headers.get('mcp-session-id')
    if (newSession) this.sessionId = newSession

    if (res.status === 401) {
      const meta = parseResourceMetadata(res.headers.get('www-authenticate'))
      throw new McpUnauthorizedError('MCP «Сільпо» вимагає авторизації', meta)
    }

    if (isNotification) return undefined as T

    const contentType = res.headers.get('content-type') ?? ''
    const raw = await res.text()

    if (!res.ok && !contentType.includes('json') && !contentType.includes('event-stream')) {
      throw new McpError(`HTTP ${res.status} від MCP`, -32000, res.status, raw.slice(0, 300))
    }

    const payload = contentType.includes('text/event-stream') ? parseSseEnvelope(raw) : safeJson(raw)
    if (!payload) throw new McpError('Порожня або нечитабельна відповідь MCP', -32700, res.status)

    if (payload.error) {
      const e = payload.error as JsonRpcError
      throw new McpError(`MCP помилка: ${e.message}`, e.code, res.status, e.data)
    }
    return payload.result as T
  }

  /** initialize + notifications/initialized. Викликається автоматично. */
  async initialize(clientName = 'silpo-family-pantry'): Promise<unknown> {
    const result = await this.rpc<unknown>('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version: '0.1.0' },
    })
    await this.rpc('notifications/initialized', {}, true).catch(() => undefined)
    this.initialized = true
    return result
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize()
  }

  /**
   * Список інструментів із їхніми JSON Schema.
   * Аргументи tools ніколи не вигадуємо — беремо схеми звідси.
   */
  async listTools(): Promise<McpToolDefinition[]> {
    await this.ensureInitialized()
    const tools: McpToolDefinition[] = []
    let cursor: string | undefined
    do {
      const page = await this.rpc<{ tools: McpToolDefinition[]; nextCursor?: string }>(
        'tools/list',
        cursor ? { cursor } : {},
      )
      tools.push(...(page.tools ?? []))
      cursor = page.nextCursor
    } while (cursor)
    logEvent('info', 'mcp.tools_list', { count: tools.length })
    return tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.ensureInitialized()
    const started = Date.now()
    const result = await this.rpc<McpCallResult>('tools/call', { name, arguments: args })
    logEvent('info', 'mcp.tool_call', { tool: name, ms: Date.now() - started, isError: !!result?.isError })
    return result
  }
}

/** Витягує JSON-RPC конверт із SSE-потоку (беремо останній повний `data:`). */
function parseSseEnvelope(raw: string): { result?: unknown; error?: unknown } | null {
  const chunks = raw.split(/\n\n/)
  for (let i = chunks.length - 1; i >= 0; i--) {
    const dataLines = chunks[i]
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
    if (dataLines.length === 0) continue
    const parsed = safeJson(dataLines.join('\n'))
    if (parsed && ('result' in parsed || 'error' in parsed)) return parsed
  }
  return null
}

function safeJson(raw: string): { result?: unknown; error?: unknown } | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** WWW-Authenticate: Bearer …, resource_metadata="URL" */
export function parseResourceMetadata(header: string | null): string | undefined {
  if (!header) return undefined
  const m = /resource_metadata="([^"]+)"/.exec(header)
  return m?.[1]
}

/** Витягує текстовий payload із результату tools/call. */
export function extractToolJson<T = unknown>(result: McpCallResult): T | null {
  if (result.structuredContent !== undefined) return result.structuredContent as T
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}
