import type { ProductOption, Kopiyky } from '@/lib/domain/types'

/** Режим, у якому працює адаптер. Показується користувачу без прикрас. */
export type McpMode = 'live' | 'mock'

/** Один запис у безпечному трейсі агента. */
export interface McpTraceEntry {
  at: string
  /** назва інструмента MCP, як її повернув tools/list */
  tool: string
  mode: McpMode
  ok: boolean
  durationMs: number
  /** аргументи після SchemaGuard і маскування */
  args: unknown
  /** скорочений і замаскований результат */
  resultPreview: unknown
  /** що саме ми перевірили в схемі перед викликом */
  schema?: { required: string[]; properties: string[] }
  error?: string
}

export interface SilpoProfile {
  displayName: string
  profileRef: string
  loyaltyCardMasked?: string
}

export interface SilpoFamilyMember {
  name: string
  type: 'adult' | 'child' | 'teen' | 'senior'
  age?: number
}

export interface SilpoRestriction {
  restrictionType: 'allergy' | 'intolerance' | 'diet' | 'dislike' | 'religious'
  value: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  memberName?: string
}

export interface SilpoOrderItem {
  productId: string
  name: string
  quantity: number
  price: Kopiyky
}

export interface SilpoOrder {
  orderId: string
  date: string
  kind: 'online_order' | 'offline_receipt'
  storeName?: string
  total: Kopiyky
  items: SilpoOrderItem[]
}

export interface SilpoLoyalty {
  balabonuses: number
  level?: string
}

export interface SilpoCoupon {
  couponId: string
  title: string
  discountPercent?: number
  discountAmount?: Kopiyky
  appliesTo: string[]
  validUntil?: string
}

export interface SilpoPromo {
  promoId: string
  title: string
  productIds: string[]
}

export interface SilpoTimeSlot {
  slotId: string
  from: string
  to: string
  available: boolean
  price: Kopiyky
}

export interface SilpoCartLine {
  productId: string
  name: string
  quantity: number
  price: Kopiyky
  promoPrice?: Kopiyky
}

export interface SilpoCart {
  cartId: string
  branchId?: string
  deliveryType?: string
  timeSlotId?: string
  lines: SilpoCartLine[]
  subtotal: Kopiyky
  discount: Kopiyky
  total: Kopiyky
  deliveryPrice: Kopiyky
  balabonusesAvailable: number
  validations: string[]
  checkoutUrl: string | null
}

/**
 * Позиція для запису в кошик. companyId і branchId обовʼязкові в живому
 * MCP «Сільпо», тому вони їдуть разом із товаром від самого пошуку.
 */
export interface CartWriteItem {
  productId: string
  quantity: number
  companyId?: string
  branchId?: string
}

export interface ProductSearchQuery {
  /** нормалізований ключ інгредієнта, для якого шукаємо */
  ingredientKey: string
  query: string
  limit?: number
}

export interface ProductSearchResult {
  ingredientKey: string
  products: ProductOption[]
}

/**
 * Єдиний контракт, який бачить агент і вся решта застосунку.
 * Реалізацій дві: LiveSilpoAdapter (справжній MCP) і MockSilpoAdapter (demo).
 * UI не знає, яка з них працює — знає лише `mode`, який чесно показує.
 */
export interface SilpoAdapter {
  readonly mode: McpMode
  /** перелік інструментів, які реально є на сервері (live) або емульовані (mock) */
  listTools(): Promise<{ name: string; description?: string }[]>
  getProfile(): Promise<SilpoProfile>
  getFamily(): Promise<SilpoFamilyMember[]>
  getRestrictions(): Promise<SilpoRestriction[]>
  getOrders(): Promise<SilpoOrder[]>
  getLoyalty(): Promise<SilpoLoyalty>
  getCoupons(): Promise<SilpoCoupon[]>
  getPromos(): Promise<SilpoPromo[]>
  findProducts(queries: ProductSearchQuery[]): Promise<ProductSearchResult[]>
  getProductDetails(productId: string): Promise<ProductOption | null>
  /** Пошук товару за штрихкодом; null — у каталозі не знайдено. */
  findByBarcode(code: string): Promise<ProductOption | null>
  getReplacements(productId: string): Promise<ProductOption[]>
  getCart(): Promise<SilpoCart>
  getTimeSlots(): Promise<SilpoTimeSlot[]>
  /** WRITE. Викликається лише після явного підтвердження користувача. */
  addToCart(items: CartWriteItem[]): Promise<SilpoCart>
  /** WRITE. */
  removeFromCart(productIds: string[]): Promise<SilpoCart>
  /**
   * WRITE. Задає ТОЧНУ кількість товару в кошику, а не додає до наявної.
   * Потрібне для кнопок «−/+» у кошику: без цього змінити кількість
   * помилково доданого товару можна було лише видаливши його й додавши знову.
   */
  setCartQuantity(productId: string, quantity: number): Promise<SilpoCart>
  /** Витягує й очищає накопичений трейс. */
  drainTrace(): McpTraceEntry[]
}
