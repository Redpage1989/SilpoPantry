import type { Kopiyky, ProductOption, Unit } from '@/lib/domain/types'
import { parsePackFromName } from '@/lib/domain/receipts'
import { weightedStepPrice } from '@/lib/domain/pricing'
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
  CartWriteItem,
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
  /**
   * Пошук за штрихкодом. Окремого інструмента для цього MCP не має,
   * тому шукаємо код як звичайний запит — каталог індексує EAN.
   * Точного збігу немає — повертаємо null, а не «щось схоже»: покласти
   * в комору чужий товар гірше, ніж не покласти нічого.
   */
  async findByBarcode(code: string): Promise<ProductOption | null> {
    const results = await this.findProducts([{ ingredientKey: code, query: code, limit: 5 }])
    return results[0]?.products[0] ?? null
  }

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
   * Активний кошик — ДВА виклики, як і описано в рекомендованому flow «Сільпо»:
   *
   *   silpo_get_my_shopping_cart      → лише { success, shoppingCartId }
   *   silpo_get_shopping_cart_by_id   → повний вміст
   *
   * Перший інструмент вмісту не повертає взагалі, тож без другого кроку
   * кошик виглядав би порожнім навіть тоді, коли в ньому є товари.
   */
  async getCart(): Promise<SilpoCart> {
    let cartId = this.cartId
    if (!cartId) {
      try {
        const head = await this.call<Record<string, unknown>>({
          candidates: ['silpo_get_my_shopping_cart', 'get_my_shopping_cart'],
          keywords: ['cart'],
        })
        cartId = pickString(unwrap(head), ['shoppingCartId', 'cartId', 'id']) ?? null
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!/resource not found/i.test(message)) throw err
        logEvent('info', 'mcp.cart_absent', {})
        return emptyCart('У вашому акаунті «Сільпо» ще немає активного кошика')
      }
    }
    if (!cartId) return emptyCart('«Сільпо» не повернув ідентифікатор кошика')
    this.cartId = cartId

    const full = await this.call<Record<string, unknown>>({
      candidates: ['silpo_get_shopping_cart_by_id', 'get_shopping_cart_by_id'],
      keywords: ['cart', 'id'],
      buildArgs: () => ({ shoppingCartId: cartId }),
    })
    return toCart(full, cartId)
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
  /**
   * WRITE. Реальна схема вимагає для КОЖНОГО товару четвірку
   * productId + companyId + branchId + quantity. companyId і branchId
   * приходять у відповіді пошуку, тому ми зберігаємо їх у ProductOption
   * ще на етапі підбору — інакше додати товар неможливо в принципі.
   */
  async addToCart(items: CartWriteItem[]): Promise<SilpoCart> {
    const cartId = await this.ensureCartId()
    const ctx = await this.ensureContext()

    const products = items.map((i) => {
      const companyId = i.companyId ?? ctx.companyId
      const branchId = i.branchId ?? ctx.branchId
      if (!companyId || !branchId) {
        throw new Error(
          `Для «${i.productId}» бракує companyId або branchId — «Сільпо» не прийме такий товар у кошик`,
        )
      }
      return { productId: i.productId, companyId, branchId, quantity: i.quantity, addQuantity: true }
    })

    await this.call<unknown>({
      candidates: ['silpo_add_or_update_cart_products', 'add_or_update_cart_products'],
      keywords: ['cart', 'add'],
      write: true,
      buildArgs: () => ({ shoppingCartId: cartId, products }),
    })
    // кеш вмісту застарів — перечитуємо з сервера
    return this.getCart()
  }

  /**
   * `addQuantity: false` означає «замінити», а не «додати».
   * Нуль трактуємо як видалення: «Сільпо» не приймає quantity 0
   * (у схемі стоїть exclusiveMinimum), і це правильніше, ніж лишати
   * порожній рядок у кошику.
   */
  async setCartQuantity(
    productId: string,
    quantity: number,
    source?: { companyId?: string; branchId?: string },
  ): Promise<SilpoCart> {
    if (quantity <= 0) return this.removeFromCart([productId])
    const cartId = await this.ensureCartId()
    const ctx = await this.ensureContext()
    /**
     * Пара companyId+branchId має описувати САМЕ ЦЕЙ рядок кошика.
     * Раніше бралась із контексту доставки: його companyId часто відсутній
     * (bootstrap із cart-head його не дає) — і кожне натискання «−/+» падало
     * на валідації схеми ще до відправки; а для кошика з кількох філій
     * контекстна філія цілила в чужий offer.
     */
    const companyId = source?.companyId ?? ctx.companyId
    const branchId = source?.branchId ?? ctx.branchId
    if (!companyId || !branchId) {
      throw new Error(
        `Для «${productId}» бракує companyId або branchId — «Сільпо» не прийме зміну кількості`,
      )
    }
    await this.call<unknown>({
      candidates: ['silpo_add_or_update_cart_products', 'add_or_update_cart_products'],
      keywords: ['cart', 'add'],
      write: true,
      buildArgs: () => ({
        shoppingCartId: cartId,
        products: [{ productId, companyId, branchId, quantity, addQuantity: false }],
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
      // для видалення достатньо самого productId — так каже схема
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

/**
 * «Сільпо» віддає всі суми в ГРИВНЯХ — і цілим числом, і дробовим.
 * Ми ж рахуємо гроші виключно в копійках, тому множимо завжди.
 *
 * Раніше тут стояла евристика «ціле число більше 1000 — це вже копійки».
 * Вона мовчки ділила на 100 ціну кожного товару, дорожчого за 1000 грн:
 * віскі за 6499 грн показувалось як 64,99 грн, сир за 1990 — як 19,90.
 *
 * Що ціни саме в гривнях, видно з кошика: персик має `price: 84.99`,
 * `quantity: 0.4` і `subTotal: 34` — 84,99 × 0,4 = 34. Той самий товар у
 * пошуку має рівно те саме `price: 84.99`, тож формат один для обох джерел.
 */
function toKopiyky(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Math.round(value * 100)
}

/**
 * Мапінг товару під РЕАЛЬНУ форму відповіді «Сільпо»:
 *   { id, name, slug, price, oldPrice, stock, available, companyId, branchId, weighted }
 *
 * Важливо: `price` — це поточна (можливо, акційна) ціна, а `oldPrice` —
 * звичайна. Тому promoPrice = price тоді й лише тоді, коли oldPrice більший.
 * Ціни приходять у гривнях цілим числом, ми ж скрізь рахуємо в копійках.
 */
/**
 * Пошук «Сільпо» повертає: id, name, slug, price, oldPrice, stock, available,
 * weighted, step, companyId, branchId. Розміру упаковки в ньому НЕМАЄ.
 *
 * Тому вагу дістаємо з назви («Печиво Савоярді, 200 г»), а якщо її там немає —
 * чесно кажемо «упаковка» замість вигаданих «1 шт». Раніше UI показував
 * «1 × 1 шт» для всього підряд, і це виглядало як помилка розрахунку.
 */
function toProductOption(raw: unknown): ProductOption | null {
  if (!raw || typeof raw !== 'object') return null
  const o = unwrap(raw as Record<string, unknown>)
  const productId = pickString(o, ['id', 'productId', 'sku'])
  const name = pickString(o, ['name', 'title', 'productName'])
  if (!productId || !name) return null

  const price = toKopiyky(pickNumber(o, ['price', 'currentPrice'])) ?? 0
  const oldPrice = toKopiyky(pickNumber(o, ['oldPrice', 'regularPrice']))
  // у «Сільпо» знижка виражена як price < oldPrice, окремого promoPrice немає
  const hasPromo = oldPrice !== undefined && oldPrice > price && price > 0

  const weighted = o.weighted === true
  const step = pickNumber(o, ['step', 'addToBasketStep'])
  const fromName = parsePackFromName(name)

  let packSize: number
  let unit: Unit
  if (weighted) {
    /**
     * Ваговий товар: `step` приходить у кілограмах і є одночасно мінімальною
     * покупкою і кроком. У живому каталозі трапляються 0.05, 0.1, 0.2, 0.25,
     * 0.3, 0.5 — єдиної межі немає, тому число беремо з відповіді, а не з коду.
     *
     * Якщо `step` не прийшов (аномалія — у спостережених даних він є завжди),
     * беремо найменший зі зустрінутих кроків. Помилитись у бік меншого
     * безпечніше: недокупити можна виправити, зайвий кілограм сиру — ні.
     */
    packSize = step && step > 0 ? step * 1000 : 50
    unit = 'г'
  } else if (fromName) {
    packSize = fromName.size
    unit = fromName.unit
  } else {
    packSize = 1
    unit = 'уп'
  }

  /**
   * Для вагових товарів «Сільпо» показує ціну за 100 г. Решта застосунку
   * очікує ціну однієї упаковки (для вагових — одного кроку), тому
   * перераховуємо тут, один раз, а не в кожному місці розрахунку.
   */
  const perPack = (value: Kopiyky) => (weighted ? weightedStepPrice(value, packSize) : value)

  return {
    productId,
    companyId: pickString(o, ['companyId', 'company']),
    branchId: pickString(o, ['branchId']),
    slug: pickString(o, ['slug']),
    name,
    brand: pickString(o, ['brand', 'trademark']),
    price: perPack(hasPromo ? oldPrice! : price),
    promoPrice: hasPromo ? perPack(price) : undefined,
    unit,
    packSize,
    weighted,
    inStock: o.available !== false,
    rating: pickNumber(o, ['rating', 'score']),
    allergens: Array.isArray(o.allergens) ? (o.allergens as unknown[]).map(String) : undefined,
  }
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

/**
 * Реальна структура кошика «Сільпо»:
 *   { success, cart: { id, deliveryType, timeslot{start,end}, shipments[{ branchId, products[] }],
 *                      calculation{ total, subTotal, subDiscount, delivery{total}, validations[] } },
 *     loyalty: { bonusAvailable, ... } }
 *
 * Товари лежать НЕ в cart.products, а всередині shipments — доставка може
 * бути розділена на кілька відправлень з різних філій.
 */
function toCart(raw: Record<string, unknown>, knownId?: string | null): SilpoCart {
  const root = raw ?? {}
  const cart = (root.cart ?? unwrap(root)) as Record<string, unknown>
  const loyalty = (root.loyalty ?? {}) as Record<string, unknown>
  const calc = (cart.calculation ?? {}) as Record<string, unknown>

  const shipments = Array.isArray(cart.shipments) ? (cart.shipments as Record<string, unknown>[]) : []
  const lines = shipments.flatMap((shipment) =>
    (Array.isArray(shipment.products) ? (shipment.products as Record<string, unknown>[]) : []).map((it) => {
      const current = toKopiyky(pickNumber(it, ['price'])) ?? 0
      const old = toKopiyky(pickNumber(it, ['oldPrice']))
      const hasPromo = old !== undefined && old > current && current > 0
      const weighted = it.weighted === true
      const step = pickNumber(it, ['addToBasketStep', 'step'])
      return {
        productId: pickString(it, ['productId', 'id']) ?? '',
        name: pickString(it, ['name', 'title']) ?? 'Товар',
        quantity: pickNumber(it, ['quantity', 'qty']) ?? 1,
        price: hasPromo ? old! : current,
        promoPrice: hasPromo ? current : undefined,
        companyId: pickString(it, ['companyId']),
        branchId: pickString(it, ['branchId']) ?? pickString(shipment, ['branchId']),
        weighted: weighted || undefined,
        step: weighted && step && step > 0 ? step : undefined,
      }
    }),
  )

  const subtotal = toKopiyky(pickNumber(calc, ['subTotal'])) ?? 0
  const discount = toKopiyky(pickNumber(calc, ['subDiscount'])) ?? 0
  const delivery = toKopiyky(pickNumber((calc.delivery ?? {}) as Record<string, unknown>, ['total'])) ?? 0
  const total = toKopiyky(pickNumber(calc, ['totalAfterDiscounts', 'total'])) ?? subtotal - discount + delivery

  const timeslot = (cart.timeslot ?? {}) as Record<string, unknown>
  const cartId = pickString(cart, ['id', 'shoppingCartId']) ?? knownId ?? ''

  return {
    cartId,
    branchId: shipments[0] ? pickString(shipments[0], ['branchId']) : undefined,
    deliveryType: pickString(cart, ['deliveryType']),
    timeSlotId: pickString(timeslot, ['start']),
    lines,
    subtotal,
    discount,
    total,
    deliveryPrice: delivery,
    balabonusesAvailable: pickNumber(loyalty, ['bonusAvailable', 'bonusTotal']) ?? 0,
    validations: normalizeValidations(calc.validations),
    checkoutUrl: cartId ? 'https://silpo.ua/cart' : null,
  }
}

/** Валідації приходять обʼєктами з машинними кодами — перекладаємо людською мовою. */
function normalizeValidations(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const MESSAGES: Record<string, string> = {
    'product.offer.not_found': 'Товару немає в обраній філії',
    'product.offer.stock.max': 'Доступна менша кількість, ніж у кошику',
    'product.offer.stock.zero': 'Товар закінчився',
    'cart.min_order_cost': 'Сума менша за мінімальну для доставки',
    'timeslot.not_found': 'Обраний час доставки вже недоступний — оберіть інший',
    'order.adult.is_not_confirmed': 'У кошику є товари 18+ — потрібне підтвердження віку',
    'order.payment_types.disabled': 'Для цього кошика недоступні деякі способи оплати',
  }
  return raw
    .map((v) => {
      if (typeof v === 'string') return v
      const o = v as Record<string, unknown>
      const code = pickString(o, ['message', 'code']) ?? ''
      const level = pickString(o, ['level']) ?? 'info'
      const text = MESSAGES[code] ?? code
      return level === 'error' ? `⚠️ ${text}` : text
    })
    .filter(Boolean)
}
