import type { ProductOption } from '@/lib/domain/types'
import { prisma } from '@/lib/db'
import { normalizeProductName } from '@/lib/domain/normalize'
import {
  MOCK_BRANCH,
  MOCK_CATALOG,
  MOCK_COUPONS,
  MOCK_FAMILY,
  MOCK_LOYALTY,
  MOCK_OFFLINE_ORDERS,
  MOCK_ONLINE_ORDERS,
  MOCK_PROFILE,
  MOCK_PROMOS,
  MOCK_RESTRICTIONS,
  MOCK_TIME_SLOTS,
  type MockProduct,
} from '@/lib/seed/silpo-mock'
import type {
  McpTraceEntry,
  ProductSearchQuery,
  ProductSearchResult,
  SilpoAdapter,
  SilpoCart,
  SilpoCartLine,
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
 * DEMO-адаптер. Повертає seed-дані у ТОЧНО тій самій формі, що й live-адаптер.
 *
 * Головне правило: mock ніколи не видає себе за live. Кожен запис трейсу
 * має `mode: 'mock'`, а назви інструментів позначені суфіксом «(demo)»,
 * щоб на екрані Agent Trace було видно різницю з першого погляду.
 */
/**
 * Демо-кошик зберігається в БД, а не в памʼяті процесу.
 *
 * Причина конкретна: адаптер створюється заново на кожен HTTP-запит,
 * а dev-сервер ще й перезавантажує модулі при зміні коду — кошик зникав
 * посеред демонстрації. У live-режимі кошик і так живе на боці «Сільпо».
 */
export async function resetDemoCart(userId?: string): Promise<void> {
  if (userId) await prisma.demoCart.deleteMany({ where: { userId } })
  else await prisma.demoCart.deleteMany({})
}

export class MockSilpoAdapter implements SilpoAdapter {
  readonly mode = 'mock' as const
  private trace: McpTraceEntry[] = []

  constructor(private readonly userId = 'demo-user') {}

  private async readCart(): Promise<SilpoCartLine[]> {
    const row = await prisma.demoCart.findUnique({ where: { userId: this.userId } })
    if (!row) return []
    try {
      const parsed = JSON.parse(row.lines)
      return Array.isArray(parsed) ? (parsed as SilpoCartLine[]) : []
    } catch {
      return []
    }
  }

  private async writeCart(lines: SilpoCartLine[]): Promise<void> {
    const data = { lines: JSON.stringify(lines) }
    await prisma.demoCart.upsert({
      where: { userId: this.userId },
      update: data,
      create: { userId: this.userId, ...data },
    })
  }

  private record(tool: string, args: unknown, result: unknown): void {
    this.trace.push({
      at: new Date().toISOString(),
      tool: `${tool} (demo)`,
      mode: 'mock',
      ok: true,
      durationMs: 0,
      args,
      resultPreview: result,
    })
  }

  drainTrace(): McpTraceEntry[] {
    const out = this.trace
    this.trace = []
    return out
  }

  async listTools() {
    const tools = [
      'silpo_get_my_profile', 'silpo_get_my_family', 'silpo_get_my_food_restrictions',
      'silpo_get_my_online_orders', 'silpo_get_my_offline_orders',
      'silpo_get_loyalty_info', 'silpo_get_my_coupons', 'silpo_get_my_promos',
      'silpo_find_products_batch', 'silpo_get_product_details', 'silpo_get_replacements',
      'silpo_get_my_shopping_cart', 'silpo_get_time_slots',
      'silpo_add_or_update_cart_products', 'silpo_remove_cart_products',
    ].map((name) => ({ name: `${name} (demo)`, description: 'Емуляція для demo mode' }))
    this.record('tools/list', {}, { count: tools.length })
    return tools
  }

  async getProfile(): Promise<SilpoProfile> {
    const data = {
      displayName: MOCK_PROFILE.displayName,
      profileRef: MOCK_PROFILE.profileId,
      loyaltyCardMasked: MOCK_PROFILE.loyaltyCardMasked,
    }
    this.record('silpo_get_my_profile', {}, data)
    return data
  }

  async getFamily(): Promise<SilpoFamilyMember[]> {
    this.record('silpo_get_my_family', {}, { count: MOCK_FAMILY.members.length })
    return MOCK_FAMILY.members
  }

  async getRestrictions(): Promise<SilpoRestriction[]> {
    this.record('silpo_get_my_food_restrictions', {}, MOCK_RESTRICTIONS)
    return MOCK_RESTRICTIONS
  }

  async getOrders(): Promise<SilpoOrder[]> {
    const offline: SilpoOrder[] = MOCK_OFFLINE_ORDERS.map((o) => ({
      orderId: o.orderId,
      date: o.date,
      kind: 'offline_receipt',
      storeName: o.storeName,
      total: o.total,
      items: o.items,
    }))
    const online: SilpoOrder[] = MOCK_ONLINE_ORDERS.map((o) => ({
      orderId: o.orderId,
      date: o.date,
      kind: 'online_order',
      total: o.total,
      items: o.items,
    }))
    this.record('silpo_get_my_offline_orders', {}, { count: offline.length })
    this.record('silpo_get_my_online_orders', {}, { count: online.length })
    return [...offline, ...online].sort((a, b) => b.date.localeCompare(a.date))
  }

  async getLoyalty(): Promise<SilpoLoyalty> {
    this.record('silpo_get_loyalty_info', {}, MOCK_LOYALTY)
    return MOCK_LOYALTY
  }

  async getCoupons(): Promise<SilpoCoupon[]> {
    this.record('silpo_get_my_coupons', {}, { count: MOCK_COUPONS.length })
    return MOCK_COUPONS
  }

  async getPromos(): Promise<SilpoPromo[]> {
    this.record('silpo_get_my_promos', {}, { count: MOCK_PROMOS.length })
    return MOCK_PROMOS
  }

  async findProducts(queries: ProductSearchQuery[]): Promise<ProductSearchResult[]> {
    const results = queries.map((q) => {
      const key = normalizeProductName(q.ingredientKey || q.query)
      const matches = MOCK_CATALOG.filter(
        (p) => p.ingredientKey === key || p.ingredientKey === q.ingredientKey || p.name.toLowerCase().includes(q.query.toLowerCase()),
      )
        .filter((p) => !p.readyMeal)
        .slice(0, q.limit ?? 5)
      return { ingredientKey: q.ingredientKey, products: matches.map(toProductOption) }
    })
    this.record(
      'silpo_find_products_batch',
      { queries: queries.map((q) => ({ query: q.query, limit: q.limit ?? 5 })) },
      results.map((r) => ({ ingredientKey: r.ingredientKey, found: r.products.length })),
    )
    return results
  }

  /** Пошук готових страв — окремо від інгредієнтів. */
  async findReadyMeals(key: string): Promise<ProductOption[]> {
    const matches = MOCK_CATALOG.filter((p) => p.readyMeal && (p.ingredientKey === key || p.name.toLowerCase().includes(key)))
    this.record('silpo_get_products', { category: 'ready_meals', query: key }, { found: matches.length })
    return matches.map(toProductOption)
  }

  async findByBarcode(code: string): Promise<ProductOption | null> {
    const p = MOCK_CATALOG.find((x) => x.barcode === code)
    this.record('silpo_get_products', { barcode: code }, p ? { name: p.name } : null)
    return p ? toProductOption(p) : null
  }

  async getProductDetails(productId: string): Promise<ProductOption | null> {
    const p = MOCK_CATALOG.find((x) => x.productId === productId)
    this.record('silpo_get_product_details', { productId }, p ? { name: p.name, allergens: p.allergens } : null)
    return p ? toProductOption(p) : null
  }

  async getReplacements(productId: string): Promise<ProductOption[]> {
    const p = MOCK_CATALOG.find((x) => x.productId === productId)
    const alts = p ? MOCK_CATALOG.filter((x) => x.ingredientKey === p.ingredientKey && x.productId !== productId) : []
    this.record('silpo_get_replacements', { productId }, { found: alts.length })
    return alts.map(toProductOption)
  }

  async getTimeSlots(): Promise<SilpoTimeSlot[]> {
    this.record('silpo_get_time_slots', { branchId: MOCK_BRANCH.branchId }, { count: MOCK_TIME_SLOTS.length })
    return MOCK_TIME_SLOTS
  }

  async getCart(): Promise<SilpoCart> {
    const cart = this.buildCart(await this.readCart())
    this.record('silpo_get_my_shopping_cart', {}, { lines: cart.lines.length, total: cart.total })
    return cart
  }

  async addToCart(items: { productId: string; quantity: number }[]): Promise<SilpoCart> {
    const lines = await this.readCart()
    for (const item of items) {
      const product = MOCK_CATALOG.find((p) => p.productId === item.productId)
      if (!product) continue
      const existing = lines.find((l) => l.productId === item.productId)
      if (existing) existing.quantity += item.quantity
      else
        lines.push({
          productId: product.productId,
          name: product.name,
          quantity: item.quantity,
          price: product.price,
          promoPrice: product.promoPrice,
        })
    }
    await this.writeCart(lines)
    const cart = this.buildCart(lines)
    this.record('silpo_add_or_update_cart_products', { items }, { lines: cart.lines.length, total: cart.total })
    return cart
  }

  async setCartQuantity(
    productId: string,
    quantity: number,
    _source?: { companyId?: string; branchId?: string },
  ): Promise<SilpoCart> {
    if (quantity <= 0) return this.removeFromCart([productId])
    const lines = await this.readCart()
    const line = lines.find((l) => l.productId === productId)
    /**
     * Live-режим у цій ситуації upsert-ить товар; мовчазний no-op ховав би
     * розбіжність. Помилка чесніша: якщо товару немає в кошику — значить,
     * кошик уже не той, який бачить користувач.
     */
    if (!line) throw new Error('Товару вже немає в кошику — оновіть сторінку')
    line.quantity = quantity
    await this.writeCart(lines)
    const cart = this.buildCart(lines)
    this.record('silpo_add_or_update_cart_products', { productId, quantity }, { lines: cart.lines.length })
    return cart
  }

  async removeFromCart(productIds: string[]): Promise<SilpoCart> {
    const lines = (await this.readCart()).filter((l) => !productIds.includes(l.productId))
    await this.writeCart(lines)
    const cart = this.buildCart(lines)
    this.record('silpo_remove_cart_products', { productIds }, { lines: cart.lines.length })
    return cart
  }

  private buildCart(cartLines: SilpoCartLine[]): SilpoCart {
    const subtotal = cartLines.reduce((s, l) => s + l.price * l.quantity, 0)
    const discount = cartLines.reduce(
      (s, l) => s + (l.promoPrice ? (l.price - l.promoPrice) * l.quantity : 0),
      0,
    )
    const deliveryPrice = cartLines.length > 0 ? 3900 : 0
    return {
      cartId: 'demo-cart-1',
      branchId: MOCK_BRANCH.branchId,
      deliveryType: MOCK_BRANCH.deliveryType,
      timeSlotId: MOCK_TIME_SLOTS.find((s) => s.available)?.slotId,
      lines: cartLines,
      subtotal,
      discount,
      total: subtotal - discount + deliveryPrice,
      deliveryPrice,
      balabonusesAvailable: MOCK_LOYALTY.balabonuses,
      validations:
        cartLines.length === 0
          ? ['Кошик порожній']
          : subtotal < 30000
            ? ['Мінімальна сума замовлення з доставкою — 300,00 грн']
            : [],
      checkoutUrl: cartLines.length > 0 ? 'https://silpo.ua/cart?demo=1' : null,
    }
  }
}

function toProductOption(p: MockProduct): ProductOption {
  return {
    productId: p.productId,
    companyId: p.companyId,
    name: p.name,
    brand: p.brand,
    price: p.price,
    promoPrice: p.promoPrice,
    unit: p.unit,
    packSize: p.packSize,
    rating: p.rating,
    allergens: p.allergens,
  }
}
