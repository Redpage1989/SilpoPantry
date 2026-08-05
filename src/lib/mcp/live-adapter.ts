import type { ProductOption, Unit } from '@/lib/domain/types'
import { McpHttpClient, extractToolJson, type McpToolDefinition } from './client'
import { buildRegistry, describeSchema, resolveTool, validateArgs, type ToolRegistry } from './schema-guard'
import {
  bootstrapDeliveryContext,
  errorPayloadMessage,
  isErrorPayload,
  type DeliveryContext,
} from './delivery-context'
import { sanitizeForTrace, logEvent, maskTail } from './pii'
import type {
  McpTraceEntry,
  ProductSearchQuery,
  ProductSearchResult,
  SilpoAdapter,
  SilpoCart,
  SilpoCoupon,
  SilpoFamilyMember,
  SilpoLoyalty,
  SilpoOrder,
  SilpoProfile,
  SilpoPromo,
  SilpoRestriction,
  SilpoTimeSlot,
} from './types'

/**
 * Живий адаптер до офіційного MCP «Сільпо».
 *
 * Ключове рішення: ми НЕ хардкодимо ані назви інструментів, ані їхні аргументи.
 * На старті сесії викликаємо tools/list, будуємо реєстр, і далі кожен виклик
 * проходить через resolveTool (знайти реальну назву) + validateArgs
 * (звірити payload зі справжньою JSON Schema сервера).
 *
 * Якщо потрібного інструмента на сервері немає — метод кидає ToolUnavailableError,
 * а рівнем вище застосунок чесно деградує в demo і каже про це користувачу.
 */

export class ToolUnavailableError extends Error {
  constructor(readonly candidates: string[]) {
    super(`Інструмент MCP не знайдено серед: ${candidates.join(', ')}`)
    this.name = 'ToolUnavailableError'
  }
}

interface CallSpec {
  candidates: string[]
  keywords?: string[]
  /** Будує аргументи з урахуванням реальної схеми інструмента. */
  buildArgs?: (tool: McpToolDefinition) => Record<string, unknown>
  /** WRITE-операції потребують явного дозволу — див. addToCart/removeFromCart. */
  write?: boolean
}

export class LiveSilpoAdapter implements SilpoAdapter {
  readonly mode = 'live' as const
  private registry: ToolRegistry | null = null
  private trace: McpTraceEntry[] = []
  /** активний cartId кешуємо, щоб не смикати сервер на кожен крок */
  private cartId: string | null = null
  /** контекст доставки: без нього каталог відповідає -32602 */
  private context: DeliveryContext | null = null
  private contextAttempted = false

  constructor(private readonly client: McpHttpClient) {}

  drainTrace(): McpTraceEntry[] {
    const out = this.trace
    this.trace = []
    return out
  }

  /** tools/list виконується один раз на сесію адаптера. */
  private async registry_(): Promise<ToolRegistry> {
    if (this.registry) return this.registry
    const started = Date.now()
    const tools = await this.client.listTools()
    this.registry = buildRegistry(tools)
    this.trace.push({
      at: new Date().toISOString(),
      tool: 'tools/list',
      mode: 'live',
      ok: true,
      durationMs: Date.now() - started,
      args: {},
      resultPreview: { count: tools.length, names: tools.map((t) => t.name).slice(0, 45) },
    })
    return this.registry
  }

  async listTools() {
    const reg = await this.registry_()
    return reg.all.map((t) => ({ name: t.name, description: t.description }))
  }

  /** Єдина точка виходу назовні: резолв назви → валідація args → виклик → трейс. */
  private async call<T>(spec: CallSpec): Promise<T> {
    const reg = await this.registry_()
    const tool = resolveTool(reg, spec.candidates, spec.keywords ?? [])
    if (!tool) throw new ToolUnavailableError(spec.candidates)

    const rawArgs = spec.buildArgs ? spec.buildArgs(tool) : {}
    const validation = validateArgs(tool, rawArgs)
    if (validation.dropped.length > 0) {
      logEvent('warn', 'mcp.args_dropped', { tool: tool.name, dropped: validation.dropped })
    }
    if (!validation.ok) {
      // не відправляємо явно невалідний payload — це і є захист від «вигаданих аргументів»
      throw new Error(`Аргументи не відповідають схемі ${tool.name}: ${validation.errors.join('; ')}`)
    }

    const started = Date.now()
    try {
      const result = await this.client.callTool(tool.name, validation.args)
      const payload = extractToolJson<T>(result)
      // Сервер повертає помилки текстом без isError — ловимо це явно,
      // інакше нормалізатор перетворить текст помилки на «порожній результат»
      if (isErrorPayload(payload)) {
        throw new Error(`${tool.name}: ${errorPayloadMessage(payload)}`)
      }
      this.trace.push({
        at: new Date().toISOString(),
        tool: tool.name,
        mode: 'live',
        ok: !result.isError,
        durationMs: Date.now() - started,
        args: sanitizeForTrace(validation.args),
        resultPreview: sanitizeForTrace(payload),
        schema: describeSchema(tool),
      })
      if (result.isError) throw new Error(`MCP повернув помилку для ${tool.name}`)
      return payload as T
    } catch (err) {
      this.trace.push({
        at: new Date().toISOString(),
        tool: tool.name,
        mode: 'live',
        ok: false,
        durationMs: Date.now() - started,
        args: sanitizeForTrace(validation.args),
        resultPreview: null,
        schema: describeSchema(tool),
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Ліниво піднімає контекст доставки. Виконується щонайбільше один раз
   * на адаптер; якщо не вдалось — каталожні методи чесно падають,
   * а рівень вище деградує в demo.
   */
  private async ensureContext(): Promise<DeliveryContext> {
    if (this.context) return this.context
    if (this.contextAttempted) throw new Error('Не вдалося визначити філію та слот доставки «Сільпо»')
    this.contextAttempted = true

    const reg = await this.registry_()
    const started = Date.now()
    const ctx = await bootstrapDeliveryContext(this.client, new Set(reg.all.map((t) => t.name)))
    this.trace.push({
      at: new Date().toISOString(),
      tool: 'bootstrapDeliveryContext',
      mode: 'live',
      ok: !!ctx,
      durationMs: Date.now() - started,
      args: {},
      resultPreview: ctx
        ? { source: ctx.source, city: ctx.branchCity, deliveryType: ctx.deliveryType, timeslot: `${ctx.timeslotStart} → ${ctx.timeslotEnd}` }
        : null,
      error: ctx ? undefined : 'Не вдалося отримати branchId і timeslot',
    })
    if (!ctx) throw new Error('Не вдалося визначити філію та слот доставки «Сільпо»')
    this.context = ctx
    return ctx
  }

  // ─────────────────────────── профіль і родина ───────────────────────────

  async getProfile(): Promise<SilpoProfile> {
    const raw = await this.call<Record<string, unknown>>({
      candidates: ['silpo_get_my_profile', 'get_my_profile'],
      keywords: ['profile'],
    })
    const obj = unwrap(raw)
    const card = pickString(obj, ['cardNumber', 'loyaltyCard', 'card'])
    return {
      displayName: pickString(obj, ['firstName', 'name', 'displayName']) ?? 'Гість',
      profileRef: pickString(obj, ['id', 'profileId', 'guestId']) ?? 'silpo-profile',
      loyaltyCardMasked: card ? maskTail(card) : undefined,
    }
  }

  async getFamily(): Promise<SilpoFamilyMember[]> {
    const raw = await this.call<unknown>({
      candidates: ['silpo_get_my_family', 'get_my_family'],
      keywords: ['family'],
    })
    return asArray(raw).map((m) => {
      const o = m as Record<string, unknown>
      const age = pickNumber(o, ['age', 'years'])
      const rawType = (pickString(o, ['type', 'role', 'memberType']) ?? '').toLowerCase()
      const type: SilpoFamilyMember['type'] =
        rawType.includes('child') || rawType.includes('kid') || (age !== undefined && age < 13)
          ? 'child'
          : age !== undefined && age < 18
            ? 'teen'
            : 'adult'
      return { name: pickString(o, ['name', 'firstName', 'displayName']) ?? 'Член родини', type, age }
    })
  }

  async getRestrictions(): Promise<SilpoRestriction[]> {
    const raw = await this.call<unknown>({
      candidates: ['silpo_get_my_food_restrictions', 'get_my_food_restrictions'],
      keywords: ['restriction'],
    })
    return asArray(raw).map((r) => {
      const o = r as Record<string, unknown>
      const value = pickString(o, ['value', 'name', 'title', 'restriction']) ?? 'обмеження'
      const kind = (pickString(o, ['type', 'restrictionType', 'category']) ?? '').toLowerCase()
      const restrictionType: SilpoRestriction['restrictionType'] = kind.includes('allerg')
        ? 'allergy'
        : kind.includes('intoler')
          ? 'intolerance'
          : kind.includes('diet')
            ? 'diet'
            : kind.includes('relig')
              ? 'religious'
              : 'dislike'
      return {
        restrictionType,
        value,
        // алергію завжди трактуємо як критичну, навіть якщо сервер не вказав рівень
        severity: restrictionType === 'allergy' ? 'critical' : 'medium',
        memberName: pickString(o, ['memberName', 'member', 'personName']),
      }
    })
  }

  // ─────────────────────────── історія покупок ───────────────────────────

  async getOrders(): Promise<SilpoOrder[]> {
    const [offline, online] = await Promise.allSettled([
      this.call<unknown>({
        candidates: ['silpo_get_my_offline_orders', 'get_my_offline_orders'],
        keywords: ['offline', 'order'],
      }),
      this.call<unknown>({
        candidates: ['silpo_get_my_online_orders', 'get_my_online_orders'],
        keywords: ['online', 'order'],
      }),
    ])
    const orders: SilpoOrder[] = []
    if (offline.status === 'fulfilled') orders.push(...asArray(offline.value).map((o) => toOrder(o, 'offline_receipt')))
    if (online.status === 'fulfilled') orders.push(...asArray(online.value).map((o) => toOrder(o, 'online_order')))
    return orders.sort((a, b) => b.date.localeCompare(a.date))
  }

  // ─────────────────────────── лояльність ───────────────────────────

  async getLoyalty(): Promise<SilpoLoyalty> {
    const raw = await this.call<Record<string, unknown>>({
      candidates: ['silpo_get_loyalty_info', 'get_loyalty_info'],
      keywords: ['loyalty'],
    })
    const o = unwrap(raw)
    return {
      balabonuses: pickNumber(o, ['balabonuses', 'bonuses', 'balance', 'points']) ?? 0,
      level: pickString(o, ['level', 'status', 'program']),
    }
  }

  async getCoupons(): Promise<SilpoCoupon[]> {
    const raw = await this.call<unknown>({
      candidates: ['silpo_get_my_coupons', 'get_my_coupons'],
      keywords: ['coupon'],
    })
    return asArray(raw).map((c) => {
      const o = c as Record<string, unknown>
      return {
        couponId: pickString(o, ['id', 'couponId']) ?? 'coupon',
        title: pickString(o, ['title', 'name', 'description']) ?? 'Купон',
        discountPercent: pickNumber(o, ['discountPercent', 'percent']),
        discountAmount: toKopiyky(pickNumber(o, ['discountAmount', 'amount'])),
        appliesTo: asArray(o.appliesTo ?? o.categories ?? []).map(String),
        validUntil: pickString(o, ['validUntil', 'endDate', 'expiresAt']),
      }
    })
  }

  async getPromos(): Promise<SilpoPromo[]> {
    const raw = await this.call<unknown>({
      candidates: ['silpo_get_my_promos', 'silpo_get_promotions', 'get_my_promos'],
      keywords: ['promo'],
    })
    return asArray(raw).map((p) => {
      const o = p as Record<string, unknown>
      return {
        promoId: pickString(o, ['id', 'promoId']) ?? 'promo',
        title: pickString(o, ['title', 'name', 'description']) ?? 'Акція',
        productIds: asArray(o.productIds ?? o.products ?? []).map((x) =>
          typeof x === 'string' ? x : String((x as Record<string, unknown>)?.id ?? ''),
        ),
      }
    })
  }

  // ─────────────────────────── каталог ───────────────────────────

  async findProducts(queries: ProductSearchQuery[]): Promise<ProductSearchResult[]> {
    const ctx = await this.ensureContext()
    const raw = await this.call<unknown>({
      candidates: ['silpo_find_products_batch', 'silpo_get_products', 'find_products_batch'],
      keywords: ['product', 'search'],
      buildArgs: () => ({
        branchId: ctx.branchId,
        deliveryType: ctx.deliveryType,
        timeslotStart: ctx.timeslotStart,
        timeslotEnd: ctx.timeslotEnd,
        // сервер очікує масив РЯДКІВ-запитів, максимум 30
        products: queries.map((q) => q.query).slice(0, 30),
        limit: Math.max(...queries.map((q) => q.limit ?? 5), 5),
      }),
    })

    // Форма відповіді: { success, queries: [{ query, totalFound, products: [...] }] }
    const groups = asArray((raw as Record<string, unknown>)?.queries ?? raw)
    return queries.map((q, index) => {
      const group = groups[index] as Record<string, unknown> | undefined
      const list = group ? asArray(group.products ?? group.items ?? group) : []
      return {
        ingredientKey: q.ingredientKey,
        products: list
          .map(toProductOption)
          .filter((p): p is ProductOption => p !== null)
          .slice(0, q.limit ?? 5),
      }
    })
  }

  /**
   * Деталі товару. Сервер приймає САМЕ slug, а не id — це видно зі схеми
   * (`required: branchId, slug, deliveryType, timeslotStart, timeslotEnd`),
   * тому slug ми зберігаємо ще на етапі пошуку.
   */
  async getProductDetails(slugOrId: string): Promise<ProductOption | null> {
    const ctx = await this.ensureContext()
    const raw = await this.call<unknown>({
      candidates: ['silpo_get_product_details', 'get_product_details'],
      keywords: ['product', 'details'],
      buildArgs: () => ({
        branchId: ctx.branchId,
        slug: slugOrId,
        deliveryType: ctx.deliveryType,
        timeslotStart: ctx.timeslotStart,
        timeslotEnd: ctx.timeslotEnd,
      }),
    })
    const obj = raw && typeof raw === 'object' ? unwrap(raw as Record<string, unknown>) : null
    return toProductOption(obj)
  }

  async getReplacements(productId: string, companyId?: string): Promise<ProductOption[]> {
    const ctx = await this.ensureContext()
    const company = companyId ?? ctx.companyId
    if (!company) return []
    const raw = await this.call<unknown>({
      candidates: ['silpo_get_replacements', 'silpo_get_similar_products', 'get_replacements'],
      keywords: ['replacement'],
      buildArgs: () => ({
        branchId: ctx.branchId,
        companyId: company,
        productIds: [productId],
        deliveryType: ctx.deliveryType,
      }),
    })
    return asArray(raw)
      .map(toProductOption)
      .filter((p): p is ProductOption => p !== null)
  }

  // ─────────────────────────── кошик ───────────────────────────

  /**
   * Активний кошик. У «Сільпо» новий акаунт може взагалі не мати кошика —
   * сервер відповідає «Resource not found». Це не помилка інтеграції,
   * тому повертаємо порожній кошик із чесним поясненням, а не падаємо.
   */
  async getCart(): Promise<SilpoCart> {
    try {
      const raw = await this.call<Record<string, unknown>>({
        candidates: ['silpo_get_my_shopping_cart', 'get_my_shopping_cart'],
        keywords: ['cart'],
      })
      const cart = toCart(raw)
      this.cartId = cart.cartId || this.cartId
      return cart
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/resource not found/i.test(message)) throw err
      logEvent('info', 'mcp.cart_absent', {})
      return emptyCart('У вашому акаунті «Сільпо» ще немає активного кошика')
    }
  }

  async getTimeSlots(): Promise<SilpoTimeSlot[]> {
    const ctx = await this.ensureContext()
    const raw = await this.call<unknown>({
      candidates: ['silpo_get_time_slots', 'get_time_slots'],
      keywords: ['time', 'slot'],
      // `start` навмисно не передаємо: на живому сервері він дає 500
      buildArgs: () => ({ branchId: ctx.branchId, limit: 48 }),
    })
    return asArray(raw)
      .map((s) => {
        const o = s as Record<string, unknown>
        return {
          slotId: pickString(o, ['id', 'slotId']) ?? `${pickString(o, ['start']) ?? ''}`,
          from: pickString(o, ['start', 'from', 'startTime']) ?? '',
          to: pickString(o, ['end', 'to', 'endTime']) ?? '',
          available: (o.available ?? o.isAvailable ?? true) === true,
          price: toKopiyky(pickNumber(o, ['deliveryCost', 'price', 'cost'])) ?? 0,
        }
      })
      .filter((s) => s.from)
  }

  /**
   * WRITE-операція. Викликається виключно з addConfirmedItemsToCart,
   * який, своєю чергою, вимагає одноразовий confirmationToken користувача.
   */
  async addToCart(items: { productId: string; quantity: number }[]): Promise<SilpoCart> {
    const cartId = await this.ensureCartId()
    await this.call<unknown>({
      candidates: ['silpo_add_or_update_cart_products', 'add_or_update_cart_products'],
      keywords: ['cart', 'add'],
      write: true,
      // реальна схема: shoppingCartId + products (НЕ cartId і не items)
      buildArgs: () => ({
        shoppingCartId: cartId,
        products: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      }),
    })
    return this.getCart()
  }

  async removeFromCart(productIds: string[]): Promise<SilpoCart> {
    const cartId = await this.ensureCartId()
    await this.call<unknown>({
      candidates: ['silpo_remove_cart_products', 'remove_cart_products'],
      keywords: ['cart', 'remove'],
      write: true,
      buildArgs: () => ({
        shoppingCartId: cartId,
        products: productIds.map((productId) => ({ productId })),
      }),
    })
    return this.getCart()
  }

  /** Без активного кошика write-операції неможливі — кажемо про це прямо. */
  private async ensureCartId(): Promise<string> {
    if (this.cartId) return this.cartId
    const cart = await this.getCart()
    if (!cart.cartId) {
      throw new Error(
        'У вашому акаунті «Сільпо» немає активного кошика. Додайте будь-який товар у застосунку «Сільпо», щоб кошик створився.',
      )
    }
    this.cartId = cart.cartId
    return this.cartId
  }
}

// ─────────────────────────── нормалізатори ───────────────────────────
// MCP-сервер може повертати дані у різних обгортках. Ці хелпери навмисно
// толерантні: краще дістати менше полів, ніж впасти на несподіваній формі.

function unwrap(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  // Реальні обгортки «Сільпо»: { success, profile } / { success, loyalty } / { success, cart }
  for (const key of ['data', 'result', 'profile', 'loyalty', 'cart', 'shoppingCart', 'item', 'payload']) {
    const inner = raw[key]
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>
  }
  return raw
}

function asArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    for (const key of [
      'items', 'data', 'results', 'products', 'orders', 'members', 'list',
      'coupons', 'slots', 'timeslots', 'restrictions', 'branches', 'promos', 'queries',
    ]) {
      const inner = (raw as Record<string, unknown>)[key]
      if (Array.isArray(inner)) return inner
    }
  }
  return raw === undefined || raw === null ? [] : [raw]
}

function pickString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}

/** Ціни можуть приходити в гривнях (float) або копійках (int). */
function toKopiyky(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Number.isInteger(value) && value > 1000 ? value : Math.round(value * 100)
}

/**
 * Мапінг товару під РЕАЛЬНУ форму відповіді «Сільпо»:
 *   { id, name, slug, price, oldPrice, stock, available, companyId, branchId, weighted }
 *
 * Важливо: `price` — це поточна (можливо, акційна) ціна, а `oldPrice` —
 * звичайна. Тому promoPrice = price тоді й лише тоді, коли oldPrice більший.
 * Ціни приходять у гривнях цілим числом, ми ж скрізь рахуємо в копійках.
 */
function toProductOption(raw: unknown): ProductOption | null {
  if (!raw || typeof raw !== 'object') return null
  const o = unwrap(raw as Record<string, unknown>)
  const productId = pickString(o, ['id', 'productId', 'sku'])
  const name = pickString(o, ['name', 'title', 'productName'])
  if (!productId || !name) return null

  const current = toKopiyky(pickNumber(o, ['price', 'currentPrice'])) ?? 0
  const old = toKopiyky(pickNumber(o, ['oldPrice', 'regularPrice']))
  const hasPromo = old !== undefined && old > current && current > 0

  /**
   * Вагу беремо з назви, бо batch-пошук «Сільпо» її окремим полем не віддає.
   * Якщо в назві її немає — це НЕ «1 г», а «одна упаковка невідомої ваги».
   * Різниця принципова: інакше ціна за 100 г вийшла б у сотні разів завищена
   * і зламала б поділ на бюджетний/оптимальний/преміальний.
   */
  const pack = parsePackFromTitle(name) ?? fallbackPack(o)

  return {
    productId,
    companyId: pickString(o, ['companyId', 'company']),
    slug: pickString(o, ['slug']),
    name,
    brand: pickString(o, ['brand', 'trademark']),
    price: hasPromo ? old! : current,
    promoPrice: hasPromo ? current : undefined,
    unit: pack.unit,
    packSize: pack.size,
    rating: pickNumber(o, ['rating', 'score']),
    allergens: Array.isArray(o.allergens) ? (o.allergens as unknown[]).map(String) : undefined,
  }
}

/** Коли ваги немає ніде — товар рахується як одна штука-упаковка. */
function fallbackPack(o: Record<string, unknown>): { size: number; unit: Unit } {
  const explicit = pickNumber(o, ['packSize', 'weight', 'volume'])
  if (explicit && explicit > 1) return { size: explicit, unit: 'г' }
  return { size: 1, unit: 'шт' }
}

/** «Сир Ghidetti «Маскарпоне» 45%, 250 г» → { size: 250, unit: 'г' } */
function parsePackFromTitle(title: string): { size: number; unit: Unit } | null {
  const m = /(\d+[.,]?\d*)\s*(кг|мл|л|шт|г)(?!\p{L})/iu.exec(title)
  if (!m) return null
  const size = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(size) || size <= 0) return null
  return { size, unit: m[2].toLowerCase() as Unit }
}

function toOrder(raw: unknown, kind: SilpoOrder['kind']): SilpoOrder {
  const o = unwrap(raw as Record<string, unknown>)
  return {
    orderId: pickString(o, ['id', 'orderId', 'number', 'receiptId']) ?? 'order',
    date: pickString(o, ['date', 'createdAt', 'orderDate', 'purchasedAt']) ?? new Date().toISOString(),
    kind,
    storeName: pickString(o, ['storeName', 'branchName', 'filialName']),
    total: toKopiyky(pickNumber(o, ['total', 'sum', 'amount'])) ?? 0,
    items: asArray(o.items ?? o.products ?? o.lines ?? []).map((i) => {
      const it = i as Record<string, unknown>
      return {
        productId: pickString(it, ['productId', 'id', 'sku']) ?? '',
        name: pickString(it, ['name', 'title', 'productName']) ?? 'Товар',
        quantity: pickNumber(it, ['quantity', 'qty', 'count']) ?? 1,
        price: toKopiyky(pickNumber(it, ['price', 'sum', 'amount'])) ?? 0,
      }
    }),
  }
}

function emptyCart(note: string): SilpoCart {
  return {
    cartId: '',
    lines: [],
    subtotal: 0,
    discount: 0,
    total: 0,
    deliveryPrice: 0,
    balabonusesAvailable: 0,
    validations: [note],
    checkoutUrl: null,
  }
}

function toCart(raw: Record<string, unknown>): SilpoCart {
  const o = unwrap(raw)
  const lines = asArray(o.products ?? o.items ?? o.lines ?? []).map((l) => {
    const it = l as Record<string, unknown>
    return {
      productId: pickString(it, ['productId', 'id']) ?? '',
      name: pickString(it, ['name', 'title']) ?? 'Товар',
      quantity: pickNumber(it, ['quantity', 'qty', 'count']) ?? 1,
      price: toKopiyky(pickNumber(it, ['price', 'regularPrice'])) ?? 0,
      promoPrice: toKopiyky(pickNumber(it, ['promoPrice', 'discountPrice'])),
    }
  })
  const subtotal = toKopiyky(pickNumber(o, ['subtotal', 'sum'])) ?? lines.reduce((s, l) => s + l.price * l.quantity, 0)
  const discount = toKopiyky(pickNumber(o, ['discount', 'totalDiscount'])) ?? 0
  const deliveryPrice = toKopiyky(pickNumber(o, ['deliveryPrice', 'deliveryCost'])) ?? 0
  return {
    cartId: pickString(o, ['id', 'cartId']) ?? '',
    branchId: pickString(o, ['branchId', 'filialId']),
    deliveryType: pickString(o, ['deliveryType', 'fulfillmentType']),
    timeSlotId: pickString(o, ['timeSlotId', 'slotId']),
    lines,
    subtotal,
    discount,
    total: toKopiyky(pickNumber(o, ['total', 'totalSum'])) ?? subtotal - discount + deliveryPrice,
    deliveryPrice,
    balabonusesAvailable: pickNumber(o, ['balabonuses', 'bonuses']) ?? 0,
    validations: asArray(o.validations ?? o.errors ?? []).map((v) =>
      typeof v === 'string' ? v : String((v as Record<string, unknown>)?.message ?? ''),
    ),
    checkoutUrl: pickString(o, ['checkoutUrl', 'checkoutLink', 'url']) ?? null,
  }
}
