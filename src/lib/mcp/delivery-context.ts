import type { McpHttpClient } from './client'
import { extractToolJson } from './client'
import { logEvent } from './pii'

/**
 * Контекст доставки — те, без чого каталог «Сільпо» взагалі не відповідає.
 *
 * Виявлено на живому сервері (`npm run mcp:inspect`): майже кожен
 * каталожний інструмент вимагає четвірку
 *   branchId + deliveryType + timeslotStart + timeslotEnd
 * і без неї повертає -32602 Input validation error.
 *
 * Тому перед першим запитом до каталогу агент виконує bootstrap:
 *
 *   1. Активний кошик користувача (там уже є філія й слот) —
 *      найточніший варіант, бо збігається з тим, що бачить Гість.
 *   2. Якщо кошика немає (новий акаунт) — беремо відкриту філію
 *      зі списку і перший доступний слот самовивозу.
 *
 * Контекст кешується на час життя адаптера: це один-два зайві виклики
 * на сесію, а не на кожен пошук товару.
 */

export interface DeliveryContext {
  branchId: string
  companyId?: string
  deliveryType: string
  timeslotStart: string
  timeslotEnd: string
  /** звідки взявся контекст — показуємо в трейсі, щоб було видно логіку */
  source: 'cart' | 'branch_fallback'
  branchCity?: string
  minOrderCost?: number
}

/**
 * Слоти повертаються від початку доби, і перші з них уже в минулому.
 * 48 — емпірично достатньо, щоб дістати до вечірніх доступних слотів.
 * Параметр `start` використовувати не можна: сервер відповідає на нього 500.
 */
const SLOT_LIMIT = 48
const BRANCH_LIMIT = 30

export async function bootstrapDeliveryContext(
  client: McpHttpClient,
  toolNames: Set<string>,
): Promise<DeliveryContext | null> {
  const fromCart = await tryContextFromCart(client, toolNames)
  if (fromCart) return fromCart
  return tryContextFromBranches(client, toolNames)
}

/** Варіант 1: у користувача вже є активний кошик із філією та слотом. */
async function tryContextFromCart(
  client: McpHttpClient,
  toolNames: Set<string>,
): Promise<DeliveryContext | null> {
  if (!toolNames.has('silpo_get_my_shopping_cart')) return null
  try {
    const raw = extractToolJson<Record<string, unknown>>(
      await client.callTool('silpo_get_my_shopping_cart', {}),
    )
    if (isErrorPayload(raw)) return null

    const cart = unwrapObject(raw, ['cart', 'shoppingCart', 'data'])
    const branchId = str(cart, ['branchId', 'filialId'])
    const deliveryType = str(cart, ['deliveryType', 'fulfillmentType'])
    const start = str(cart, ['timeslotStart', 'timeSlotStart'])
    const end = str(cart, ['timeslotEnd', 'timeSlotEnd'])
    if (!branchId || !deliveryType || !start || !end) return null

    logEvent('info', 'mcp.context_from_cart', { deliveryType })
    return {
      branchId,
      companyId: str(cart, ['companyId']),
      deliveryType,
      timeslotStart: start,
      timeslotEnd: end,
      source: 'cart',
    }
  } catch {
    return null
  }
}

/** Варіант 2: новий акаунт без кошика — беремо відкриту філію й слот самовивозу. */
async function tryContextFromBranches(
  client: McpHttpClient,
  toolNames: Set<string>,
): Promise<DeliveryContext | null> {
  if (!toolNames.has('silpo_list_branches') || !toolNames.has('silpo_get_time_slots')) return null

  try {
    const branchesRaw = extractToolJson<Record<string, unknown>>(
      await client.callTool('silpo_list_branches', { limit: BRANCH_LIMIT, hasPickup: true }),
    )
    if (isErrorPayload(branchesRaw)) return null

    const branches = arr(branchesRaw, ['branches', 'items', 'data'])
    // Пробуємо кілька філій: у частини з них узагалі немає доступних слотів
    for (const candidate of branches.filter(isOpenBranch).slice(0, 5)) {
      const branch = candidate as Record<string, unknown>
      const branchId = str(branch, ['branchId', 'id'])
      if (!branchId) continue

      const slotsRaw = extractToolJson<Record<string, unknown>>(
        await client.callTool('silpo_get_time_slots', { branchId, limit: SLOT_LIMIT }),
      )
      if (isErrorPayload(slotsRaw)) continue

      const slots = arr(slotsRaw, ['slots', 'timeslots', 'items'])
      const usable =
        slots.find((s) => (s as Record<string, unknown>).available === true) ?? slots[slots.length - 1]
      if (!usable) continue

      const slot = usable as Record<string, unknown>
      const start = str(slot, ['start', 'from', 'startTime'])
      const end = str(slot, ['end', 'to', 'endTime'])
      if (!start || !end) continue

      logEvent('info', 'mcp.context_from_branch', {
        city: str(branch, ['city']),
        available: slot.available === true,
      })
      return {
        branchId,
        companyId: str(branch, ['companyId']),
        deliveryType: str(slot, ['deliveryType']) ?? 'SelfPickup',
        timeslotStart: start,
        timeslotEnd: end,
        source: 'branch_fallback',
        branchCity: str(branch, ['city']),
        minOrderCost: num(slot, ['minOrderCost']),
      }
    }
    return null
  } catch (err) {
    logEvent('warn', 'mcp.context_bootstrap_failed', {
      message: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

function isOpenBranch(b: unknown): boolean {
  return typeof b === 'object' && b !== null && (b as Record<string, unknown>).open !== false
}

/**
 * MCP «Сільпо» повертає помилки як звичайний текст у content,
 * БЕЗ прапорця isError. Приклади, зняті з живого сервера:
 *   "Error in get-my-shopping-cart: Resource not found."
 *   "Error in get-time-slots: API returned 500 Internal Server Error."
 * Без цієї перевірки нормалізатори мовчки перетворили б текст помилки
 * на «порожній кошик» — і користувач побачив би неправду.
 */
export function isErrorPayload(payload: unknown): boolean {
  if (typeof payload !== 'string') return false
  return /^(error in |mcp error|api returned)/i.test(payload.trim())
}

export function errorPayloadMessage(payload: unknown): string {
  return typeof payload === 'string' ? payload.slice(0, 200) : 'невідома помилка MCP'
}

// ─── маленькі помічники читання нетипізованих відповідей ───

function unwrapObject(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const obj = raw as Record<string, unknown>
  for (const key of keys) {
    const inner = obj[key]
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>
  }
  return obj
}

function arr(raw: unknown, keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  for (const key of keys) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[]
  }
  return []
}

function str(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

function num(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}
