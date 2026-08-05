/**
 * Маскування персональних даних перед тим, як щось потрапить
 * у лог, у agent trace або на екран.
 *
 * Правило прототипу: у трейс іде лише те, що потрібно, щоб довести
 * факт MCP-виклику. Токени, телефони, email, адреси й номери карток
 * не показуються ніколи — навіть частково, крім останніх 4 цифр картки.
 */

const SENSITIVE_KEYS = [
  'access_token', 'accesstoken', 'refresh_token', 'refreshtoken', 'token', 'authorization',
  'client_secret', 'clientsecret', 'code_verifier', 'codeverifier', 'password', 'secret',
  'phone', 'phonenumber', 'mobile', 'email', 'mail',
  'address', 'street', 'apartment', 'flat', 'house', 'building', 'zip', 'postcode',
  'cardnumber', 'card', 'pan', 'cvv', 'iban', 'taxid', 'inn', 'passport',
  'firstname', 'lastname', 'middlename', 'fullname', 'patronymic',
  // дата народження приходить під різними іменами — ловимо всі
  'birthdate', 'dateofbirth', 'birthday', 'birthdayat', 'dob',
  'gender', 'sex',
  'latitude', 'longitude', 'lat', 'lng', 'coordinates',
]

/**
 * Ключі, наявність яких означає «цей обʼєкт описує людину».
 * Потрібні, бо `name` маскувати завжди не можна — це ще й назва товару,
 * купона чи категорії, і без неї трейс стає нечитабельним.
 */
const PERSON_MARKERS = ['phone', 'email', 'birthday', 'birthdate', 'profileid', 'itsme', 'patronymic']

/** У контексті людини ці поля теж стають персональними даними. */
const PERSON_SCOPED_KEYS = ['name', 'displayname', 'title', 'image', 'avatar', 'photo']

function looksLikePerson(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj).map((k) => k.toLowerCase())
  return PERSON_MARKERS.some((marker) => keys.includes(marker))
}

/** Технічні id, які не потрібні для демонстрації і теж ховаються. */
const OPAQUE_ID_KEYS = ['userid', 'profileid', 'clientid', 'sessionid', 'deviceid', 'loyaltyid', 'cardid']

const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g
/**
 * Український номер. Межі навмисно суворі: без них шаблон ловив шматки
 * UUID (`00000000-0000-0000-...`) і перетворював ідентифікатори філій
 * на «телефон приховано» — трейс ставав нечитабельним і вводив в оману.
 */
const PHONE_RE = /(?<![\w-])(\+?38[\s-]?)?\(?0\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\w-])/g
const LONG_TOKEN_RE = /\b[A-Za-z0-9_-]{40,}\b/g

export function maskString(input: string): string {
  return input
    .replace(EMAIL_RE, '«email приховано»')
    .replace(PHONE_RE, '«телефон приховано»')
    .replace(LONG_TOKEN_RE, '«токен приховано»')
}

/** Показує лише останні 4 символи — для номера картки лояльності. */
export function maskTail(value: string, keep = 4): string {
  const s = String(value)
  if (s.length <= keep) return '••••'
  return `•••• ${s.slice(-keep)}`
}

/** Скорочує технічний ідентифікатор до впізнаваного, але неповного вигляду. */
export function shortenId(value: string): string {
  const s = String(value)
  return s.length <= 8 ? s : `${s.slice(0, 4)}…${s.slice(-2)}`
}

/**
 * Рекурсивно очищає будь-яку структуру перед записом у trace/лог.
 * Обрізає також розмір: у трейсі не потрібні мегабайтні відповіді.
 */
export function sanitizeForTrace(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return maskString(value.length > 400 ? `${value.slice(0, 400)}…` : value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const limited = value.slice(0, 20).map((v) => sanitizeForTrace(v, depth + 1))
    return value.length > 20 ? [...limited, `…ще ${value.length - 20}`] : limited
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const isPerson = looksLikePerson(obj)
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj)) {
      const lower = key.toLowerCase()
      if (SENSITIVE_KEYS.some((k) => lower.includes(k))) {
        out[key] = '«приховано»'
        continue
      }
      // «name» — це і назва товару, і імʼя людини. Маскуємо лише друге.
      if (isPerson && PERSON_SCOPED_KEYS.includes(lower)) {
        out[key] = '«приховано»'
        continue
      }
      if (OPAQUE_ID_KEYS.some((k) => lower === k)) {
        out[key] = typeof val === 'string' ? shortenId(val) : '«приховано»'
        continue
      }
      out[key] = sanitizeForTrace(val, depth + 1)
    }
    return out
  }
  return String(value)
}

/** Структурований серверний лог із маскуванням. */
export function logEvent(level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(sanitizeForTrace(data) as Record<string, unknown>),
  }
  const line = JSON.stringify(payload)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}
