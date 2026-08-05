/**
 * Демонстраційні дані, що імітують ФОРМУ відповідей MCP «Сільпо».
 *
 * ВАЖЛИВО: це вигадані дані для demo mode. Вони ніколи не видаються
 * за реальні — кожна відповідь адаптера позначена `mode: 'mock'`,
 * а в інтерфейсі показується бейдж DEMO. Персональних даних тут немає:
 * імена умовні, телефонів/адрес/номерів карток немає взагалі.
 */

export interface MockProduct {
  productId: string
  companyId: string
  name: string
  brand?: string
  /** копійки */
  price: number
  promoPrice?: number
  unit: 'г' | 'кг' | 'мл' | 'л' | 'шт'
  packSize: number
  rating?: number
  allergens?: string[]
  /** нормалізований ключ інгредієнта, для якого цей товар підходить */
  ingredientKey: string
  /** готова страва, а не інгредієнт */
  readyMeal?: { servings: number }
}

export const MOCK_CATALOG: MockProduct[] = [
  // ── маскарпоне ─────────────────────────────────────────────
  { productId: 'p-masc-01', companyId: 'c-1', name: 'Сир Маскарпоне 78%, 250 г', brand: 'Молокія', price: 12900, unit: 'г', packSize: 250, rating: 4.4, allergens: ['лактоза', 'молочний білок'], ingredientKey: 'маскарпоне' },
  { productId: 'p-masc-02', companyId: 'c-1', name: 'Сир Mascarpone Galbani, 250 г', brand: 'Galbani', price: 18900, promoPrice: 15900, unit: 'г', packSize: 250, rating: 4.8, allergens: ['лактоза', 'молочний білок'], ingredientKey: 'маскарпоне' },
  { productId: 'p-masc-03', companyId: 'c-1', name: 'Сир Маскарпоне Bonfesto, 500 г', brand: 'Bonfesto', price: 27900, unit: 'г', packSize: 500, rating: 4.6, allergens: ['лактоза', 'молочний білок'], ingredientKey: 'маскарпоне' },

  // ── савоярді ───────────────────────────────────────────────
  { productId: 'p-sav-01', companyId: 'c-1', name: 'Печиво Савоярді, 200 г', brand: 'Власна марка', price: 7900, unit: 'г', packSize: 200, rating: 4.1, allergens: ['глютен', 'яйця'], ingredientKey: 'савоярді' },
  { productId: 'p-sav-02', companyId: 'c-1', name: 'Печиво Savoiardi Vicenzi, 200 г', brand: 'Vicenzi', price: 13900, promoPrice: 11900, unit: 'г', packSize: 200, rating: 4.7, allergens: ['глютен', 'яйця'], ingredientKey: 'савоярді' },
  { productId: 'p-sav-03', companyId: 'c-1', name: 'Печиво Savoiardi Bonomi, 400 г', brand: 'Bonomi', price: 24900, unit: 'г', packSize: 400, rating: 4.5, allergens: ['глютен', 'яйця'], ingredientKey: 'савоярді' },

  // ── какао ──────────────────────────────────────────────────
  { productId: 'p-cocoa-01', companyId: 'c-1', name: 'Какао-порошок, 100 г', brand: 'Власна марка', price: 5900, unit: 'г', packSize: 100, rating: 4.0, allergens: [], ingredientKey: 'какао' },
  { productId: 'p-cocoa-02', companyId: 'c-1', name: 'Какао-порошок Van Houten, 250 г', brand: 'Van Houten', price: 18900, unit: 'г', packSize: 250, rating: 4.8, allergens: [], ingredientKey: 'какао' },

  // ── шпинат ─────────────────────────────────────────────────
  { productId: 'p-spin-01', companyId: 'c-1', name: 'Шпинат свіжий, 100 г', price: 4900, unit: 'г', packSize: 100, rating: 4.2, allergens: [], ingredientKey: 'шпинат' },
  { productId: 'p-spin-02', companyId: 'c-1', name: 'Шпинат заморожений, 400 г', price: 8900, promoPrice: 6900, unit: 'г', packSize: 400, rating: 4.3, allergens: [], ingredientKey: 'шпинат' },

  // ── сир твердий ────────────────────────────────────────────
  { productId: 'p-chee-01', companyId: 'c-1', name: 'Сир Голландський 45%, 200 г', price: 9900, unit: 'г', packSize: 200, rating: 4.2, allergens: ['лактоза', 'молочний білок'], ingredientKey: 'сир твердий' },
  { productId: 'p-chee-02', companyId: 'c-1', name: 'Сир Пармезан 32%, 150 г', brand: 'Grand Cru', price: 22900, promoPrice: 19900, unit: 'г', packSize: 150, rating: 4.9, allergens: ['лактоза', 'молочний білок'], ingredientKey: 'сир твердий' },

  // ── куряче філе ────────────────────────────────────────────
  { productId: 'p-chick-01', companyId: 'c-1', name: 'Філе куряче охолоджене, 1 кг', price: 21900, promoPrice: 18900, unit: 'г', packSize: 1000, rating: 4.4, allergens: [], ingredientKey: 'куряче філе' },
  { productId: 'p-chick-02', companyId: 'c-1', name: 'Філе куряче Наша Ряба, 500 г', brand: 'Наша Ряба', price: 14900, unit: 'г', packSize: 500, rating: 4.6, allergens: [], ingredientKey: 'куряче філе' },

  // ── базове ─────────────────────────────────────────────────
  { productId: 'p-egg-01', companyId: 'c-1', name: 'Яйця курячі С1, 10 шт', price: 7900, unit: 'шт', packSize: 10, rating: 4.3, allergens: ['яйця'], ingredientKey: 'яйця' },
  { productId: 'p-milk-01', companyId: 'c-1', name: 'Молоко 2,5%, 900 мл', price: 4290, unit: 'мл', packSize: 900, rating: 4.4, allergens: ['лактоза'], ingredientKey: 'молоко' },
  { productId: 'p-sugar-01', companyId: 'c-1', name: 'Цукор білий кристалічний, 1 кг', price: 4900, unit: 'г', packSize: 1000, rating: 4.5, allergens: [], ingredientKey: 'цукор' },
  { productId: 'p-flour-01', companyId: 'c-1', name: 'Борошно пшеничне в/г, 1 кг', price: 3900, unit: 'г', packSize: 1000, rating: 4.4, allergens: ['глютен'], ingredientKey: 'борошно' },
  { productId: 'p-pasta-01', companyId: 'c-1', name: 'Макарони Спагеті, 400 г', price: 4500, unit: 'г', packSize: 400, rating: 4.3, allergens: ['глютен'], ingredientKey: 'макарони' },
  { productId: 'p-tom-01', companyId: 'c-1', name: 'Помідори червоні, 1 кг', price: 8900, unit: 'г', packSize: 1000, rating: 4.1, allergens: [], ingredientKey: 'помідори' },
  { productId: 'p-butter-01', companyId: 'c-1', name: 'Масло вершкове 72,6%, 200 г', price: 9900, promoPrice: 8400, unit: 'г', packSize: 200, rating: 4.5, allergens: ['лактоза', 'молочний білок'], ingredientKey: 'масло вершкове' },
  { productId: 'p-coffee-01', companyId: 'c-1', name: 'Кава мелена, 250 г', price: 15900, unit: 'г', packSize: 250, rating: 4.4, allergens: [], ingredientKey: 'кава' },
  { productId: 'p-onion-01', companyId: 'c-1', name: 'Цибуля ріпчаста, 1 кг', price: 2900, unit: 'г', packSize: 1000, rating: 4.0, allergens: [], ingredientKey: 'цибуля' },
  { productId: 'p-garlic-01', companyId: 'c-1', name: 'Часник, 200 г', price: 5900, unit: 'г', packSize: 200, rating: 4.1, allergens: [], ingredientKey: 'часник' },
  { productId: 'p-oil-01', companyId: 'c-1', name: 'Олія соняшникова, 900 мл', price: 6900, unit: 'мл', packSize: 900, rating: 4.3, allergens: [], ingredientKey: 'олія' },
  { productId: 'p-tvorog-01', companyId: 'c-1', name: 'Сир кисломолочний 9%, 400 г', price: 8900, unit: 'г', packSize: 400, rating: 4.2, allergens: ['лактоза', 'молочний білок'], ingredientKey: 'сир кисломолочний' },

  // ── готові страви (для порівняння «готувати vs купити») ────
  { productId: 'p-ready-tir-01', companyId: 'c-1', name: 'Тірамісу, порція 120 г (кулінарія)', price: 8900, unit: 'г', packSize: 120, rating: 4.5, allergens: ['лактоза', 'глютен', 'яйця'], ingredientKey: 'тірамісу', readyMeal: { servings: 1 } },
  { productId: 'p-ready-tir-02', companyId: 'c-1', name: 'Торт Тірамісу, 600 г', price: 34900, promoPrice: 29900, unit: 'г', packSize: 600, rating: 4.6, allergens: ['лактоза', 'глютен', 'яйця'], ingredientKey: 'тірамісу', readyMeal: { servings: 6 } },
  { productId: 'p-ready-pasta-01', companyId: 'c-1', name: 'Паста зі шпинатом (кулінарія), 350 г', price: 12900, unit: 'г', packSize: 350, rating: 4.2, allergens: ['глютен', 'лактоза'], ingredientKey: 'паста зі шпинатом', readyMeal: { servings: 1 } },
]

/** Історія покупок — джерело №1 для наповнення комори. */
export const MOCK_OFFLINE_ORDERS = [
  {
    orderId: 'off-2026-09-08-1042',
    date: '2026-09-08T18:24:00+03:00',
    storeName: 'Сільпо (демо-магазин №1)',
    total: 84730,
    items: [
      { productId: 'p-egg-01', name: 'Яйця курячі С1, 10 шт', quantity: 1, price: 7900 },
      { productId: 'p-milk-01', name: 'Молоко 2,5%, 900 мл', quantity: 2, price: 4290 },
      { productId: 'p-butter-01', name: 'Масло вершкове 72,6%, 200 г', quantity: 1, price: 8400 },
      { productId: 'p-pasta-01', name: 'Макарони Спагеті, 400 г', quantity: 1, price: 4500 },
      { productId: 'p-tom-01', name: 'Помідори червоні, 1 кг', quantity: 1, price: 8900 },
      { productId: 'p-coffee-01', name: 'Кава мелена, 250 г', quantity: 1, price: 15900 },
      { productId: 'p-sugar-01', name: 'Цукор білий кристалічний, 1 кг', quantity: 1, price: 4900 },
    ],
  },
  {
    orderId: 'off-2026-09-05-0917',
    date: '2026-09-05T11:02:00+03:00',
    storeName: 'Сільпо (демо-магазин №2)',
    total: 41800,
    items: [
      { productId: 'p-spin-01', name: 'Шпинат свіжий, 100 г', quantity: 2, price: 4900 },
      { productId: 'p-masc-01', name: 'Сир Маскарпоне 78%, 250 г', quantity: 1, price: 12900 },
      { productId: 'p-onion-01', name: 'Цибуля ріпчаста, 1 кг', quantity: 1, price: 2900 },
      { productId: 'p-oil-01', name: 'Олія соняшникова, 900 мл', quantity: 1, price: 6900 },
    ],
  },
]

export const MOCK_ONLINE_ORDERS = [
  {
    orderId: 'onl-2026-09-02-7781',
    date: '2026-09-02T14:40:00+03:00',
    deliveryType: 'delivery',
    total: 52600,
    items: [
      { productId: 'p-chick-02', name: 'Філе куряче Наша Ряба, 500 г', quantity: 1, price: 14900 },
      { productId: 'p-chee-01', name: 'Сир Голландський 45%, 200 г', quantity: 1, price: 9900 },
      { productId: 'p-flour-01', name: 'Борошно пшеничне в/г, 1 кг', quantity: 1, price: 3900 },
      { productId: 'p-tvorog-01', name: 'Сир кисломолочний 9%, 400 г', quantity: 1, price: 8900 },
    ],
  },
]

/** Профіль і родина — умовні дані, без телефонів, email та адрес. */
export const MOCK_PROFILE = {
  profileId: 'demo-profile',
  displayName: 'Антон',
  /** маскується в трейсі й ніколи не логується повністю */
  loyaltyCardMasked: '•••• 4821',
}

export const MOCK_FAMILY = {
  members: [
    { name: 'Антон', type: 'adult' as const, age: 36 },
    { name: 'Олена', type: 'adult' as const, age: 34 },
    { name: 'Марко', type: 'child' as const, age: 8 },
  ],
}

export const MOCK_RESTRICTIONS = [
  { restrictionType: 'dislike' as const, value: 'гостре', severity: 'medium' as const, memberName: 'Марко' },
]

export const MOCK_LOYALTY = {
  /** «балабонуси» — внутрішня валюта програми лояльності */
  balabonuses: 1240,
  level: 'Власний Рахунок',
}

export const MOCK_COUPONS = [
  { couponId: 'cp-01', title: '−15% на молочну групу', discountPercent: 15, appliesTo: ['маскарпоне', 'сир твердий', 'молоко', 'масло вершкове'], validUntil: '2026-09-20' },
  { couponId: 'cp-02', title: '−20 грн на кондитерські вироби', discountAmount: 2000, appliesTo: ['савоярді'], validUntil: '2026-09-15' },
]

export const MOCK_PROMOS = [
  { promoId: 'pr-01', title: 'Тиждень італійської кухні: −3 грн на пасту', productIds: ['p-pasta-01'] },
  { promoId: 'pr-02', title: 'Знижка на маскарпоне Galbani', productIds: ['p-masc-02'] },
]

export const MOCK_TIME_SLOTS = [
  { slotId: 'ts-1', from: '2026-09-10T18:00:00+03:00', to: '2026-09-10T20:00:00+03:00', available: true, price: 4900 },
  { slotId: 'ts-2', from: '2026-09-10T20:00:00+03:00', to: '2026-09-10T22:00:00+03:00', available: true, price: 3900 },
  { slotId: 'ts-3', from: '2026-09-11T10:00:00+03:00', to: '2026-09-11T12:00:00+03:00', available: false, price: 3900 },
]

export const MOCK_BRANCH = { branchId: 'demo-branch-1', name: 'Сільпо (демо-філія)', deliveryType: 'delivery' }
