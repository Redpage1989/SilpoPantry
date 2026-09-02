/**
 * Перезапис демо під фактичну довжину озвучки.
 *
 * Попередній запис тримав сцени по 5–20 секунд «на око», а озвучка вийшла
 * коротшою — 91 секунда тиші, тобто третина відео. Тут кожна сцена триває
 * рівно свою репліку плюс коротка пауза; тривалості беруться з
 * docs/demo-replica-durations.json, заміряного на справжній доріжці.
 *
 * pace() ставиться ОСТАННІМ перед наступним beat(): він добирає час, що
 * лишився. Якщо дії всередині сцени вже з'їли більше за ціль (сканування
 * й пошук страви інакше не встигають), сцена йде своєю довжиною, а скрипт
 * це друкує — далі озвучка кладеться на фактичні межі, а не на бажані.
 */
import { chromium, type Page, type Locator } from '@playwright/test'
import { mkdirSync, readdirSync, renameSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://localhost:3210'
const OUT = 'tutorial-out'
const GAP = 0.9 // пауза між репліками, секунди

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAA4UlEQVR4nGNgYOXiF5GUU9bQNTK3cXTzDgiNik/JzCuuqG1q75k4bfaCpavWb9m57/CJs5eu33n47PWHr7/+s3DyCUvIKqnrGJpZO7h6+YdExiVn5BaV1zS2dU+YOmv+kpXrNu/Ye+j4mYvXbj94+ur9l5//mDl4hcRlFNW0DUyt7F08/YIjYpPScwrLqhtau/qnzJy3eMXaTdv3HDx2mmHUQaMOGnXQqINGHTTqoFEHjTpo1EGjDhp10KiDRh006qBRB406aNRBow4addCog0YdNOqgUQeNOmjUQaMOop+DAKJ6xTW+vsnbAAAAAElFTkSuQmCC'

const OVERLAY = `(() => {
  const install = () => {
    if (document.getElementById('pres-finger')) return
    const f = document.createElement('div')
    f.id = 'pres-finger'
    f.style.cssText = ['position:fixed','width:34px','height:34px','z-index:2147483001',
      'border:3px solid rgba(255,122,0,0.92)','background:rgba(255,170,60,0.28)',
      'border-radius:50%','transform:translate(-50%,-50%)','opacity:0',
      'transition:left 0.5s cubic-bezier(.3,.8,.3,1),top 0.5s cubic-bezier(.3,.8,.3,1),opacity 0.25s',
      'pointer-events:none'].join(';')
    document.body.append(f)
  }
  if (document.readyState !== 'loading') install()
  else document.addEventListener('DOMContentLoaded', install)
})()`

const TARGETS: number[] = JSON.parse(
  readFileSync('docs/demo-replica-durations.json', 'utf8'),
).durations.map((d: number) => d + GAP)

let t0 = 0
let sceneAt = 0
let idx = -1
const marks: { i: number; start: number; label: string }[] = []
const over: string[] = []

function beat(label: string) {
  const now = Date.now()
  if (idx >= 0) {
    const actual = (now - sceneAt) / 1000
    const want = TARGETS[idx]
    if (actual > want + 0.35) over.push(`${idx + 1} «${marks[idx].label}» ${actual.toFixed(1)} с проти ${want.toFixed(1)}`)
  }
  idx += 1
  sceneAt = now
  marks.push({ i: idx, start: (now - t0) / 1000, label })
}

async function pace(page: Page) {
  const left = TARGETS[idx] * 1000 - (Date.now() - sceneAt)
  if (left > 0) await page.waitForTimeout(left)
}

async function tap(page: Page, t: Locator) {
  await t.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  const b = await t.boundingBox()
  if (b) {
    await page.evaluate(([x, y]) => {
      const f = document.getElementById('pres-finger')
      if (!f) return
      f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.opacity = '1'
    }, [b.x + b.width / 2, b.y + b.height / 2])
    await page.waitForTimeout(600)
  }
  await t.click()
  await page.evaluate(() => {
    const f = document.getElementById('pres-finger')
    if (f) f.style.opacity = '0'
  })
}

async function scrollTo(page: Page, y: number, settle = 1300) {
  await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y)
  await page.waitForTimeout(settle)
}

async function card(page: Page, inner: string) {
  await page.evaluate((h) => {
    const o = document.createElement('div')
    o.id = 'pres-card'
    o.style.cssText = ['position:fixed','inset:0','z-index:2147483100','background:#16161c',
      'display:flex','flex-direction:column','align-items:center','justify-content:center',
      'gap:16px','opacity:0','transition:opacity 0.6s ease','text-align:center','padding:28px'].join(';')
    o.innerHTML = h
    document.body.append(o)
    requestAnimationFrame(() => (o.style.opacity = '1'))
  }, inner)
}

async function uncard(page: Page) {
  await page.evaluate(() => {
    const o = document.getElementById('pres-card')
    if (o) o.style.opacity = '0'
  })
  await page.waitForTimeout(700)
  await page.evaluate(() => document.getElementById('pres-card')?.remove())
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: { width: 390, height: 844 } }, locale: 'uk-UA',
  })
  await ctx.addInitScript(OVERLAY)
  const page = await ctx.newPage()
  t0 = Date.now()

  // 1 титр
  await page.goto('/login'); await page.waitForLoadState('networkidle')
  beat('титр')
  await card(page,
    '<div style="font-size:70px">🧺</div>' +
    '<div style="color:#fff;font:800 27px/1.2 -apple-system,system-ui,sans-serif">Сільпо: Сімейна комора</div>' +
    '<div style="color:#9a9aa5;font:400 15px/1.5 -apple-system,system-ui,sans-serif">AI-агент на офіційному MCP «Сільпо»</div>')
  await pace(page); await uncard(page)

  // 2 вхід
  beat('вхід')
  await scrollTo(page, 240)
  await pace(page)
  await tap(page, page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }))
  await page.waitForURL('**/'); await page.getByRole('heading', { name: 'Антон' }).waitFor({ timeout: 30_000 })

  // 3 головна
  beat('головна'); await pace(page)
  // 4 шпинат
  beat('шпинат'); await scrollTo(page, 430); await pace(page)
  await scrollTo(page, 0, 900)

  // 5 сканування
  await tap(page, page.getByRole('link', { name: 'Сканувати' }))
  await page.getByRole('heading', { name: 'Сканування' }).waitFor()
  beat('сканування')
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="scan-file-input"]')
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'))
  })
  await page.getByTestId('scan-file-input').setInputFiles({
    name: 'fridge.png', mimeType: 'image/png', buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  await page.getByText(/Фото до аналізу: 1/).waitFor()
  await pace(page)
  await tap(page, page.getByRole('button', { name: 'Розпізнати продукти' }))
  await page.getByText(/Підтвердіть розпізнане/).waitFor({ timeout: 20_000 })

  // 6 підтвердження
  beat('підтвердження'); await scrollTo(page, 380); await pace(page)
  await tap(page, page.getByRole('button', { name: /Підтвердити та зберегти/ }))
  await page.getByText(/Додано до комори:/).waitFor()

  // 7 комора
  await tap(page, page.getByRole('link', { name: 'Комора' }))
  await page.waitForURL('**/pantry')
  await page.getByRole('heading', { name: 'Домашня комора' }).waitFor()
  beat('комора'); await scrollTo(page, 480); await pace(page)
  await scrollTo(page, 0, 900)

  // 8 підбір
  await tap(page, page.getByRole('link', { name: 'Рецепти' }))
  await page.getByRole('heading', { name: 'Що можна приготувати?' }).waitFor()
  await tap(page, page.getByRole('button', { name: 'Підібрати страви' }))
  const why = page.getByRole('button', { name: 'Чому саме ця страва?' })
  await why.first().waitFor({ timeout: 20_000 })
  beat('підбір'); await pace(page)

  // 9 скоринг
  await tap(page, why.first())
  await page.getByText(/Підсумковий бал:/).waitFor()
  beat('скоринг'); await pace(page)

  // 10 рецепт
  await page.goto('/recipes/frytata-zi-shpynatom?servings=2')
  await page.getByRole('heading', { name: 'Фрітата зі шпинатом' }).waitFor()
  beat('рецепт'); await scrollTo(page, 700); await pace(page)

  // 11 списання
  await tap(page, page.getByRole('button', { name: 'Я це приготував' }))
  await page.getByText('Списати ці інгредієнти з комори?').waitFor()
  beat('списання'); await pace(page)
  await tap(page, page.getByRole('button', { name: 'Так, списати' }))
  await page.getByText('Комору оновлено').waitFor()

  // 12 тірамісу
  await page.goto('/')
  const q = page.getByLabel('Що ви хочете приготувати'); await q.waitFor()
  beat('тірамісу')
  await tap(page, q); await q.pressSequentially('Тірамісу', { delay: 90 })
  await pace(page)
  await tap(page, page.getByRole('button', { name: 'Знайти' }))
  await page.getByRole('heading', { name: 'Тірамісу' }).waitFor({ timeout: 25_000 })

  // 13 звірив
  beat('звірив комору'); await pace(page)
  // 14 три рівні
  beat('три рівні'); await scrollTo(page, 700); await pace(page)
  // 15 готувати чи купити
  beat('готувати чи купити'); await scrollTo(page, 1500); await pace(page)

  // 16 підтвердження кошика
  await tap(page, page.getByRole('button', { name: 'Додати до кошика' }))
  await page.getByText('Підтвердіть зміну кошика').waitFor()
  beat('підтвердження кошика'); await pace(page)
  await tap(page, page.getByRole('button', { name: 'Так, додати' }))
  await page.getByText('Товари додано до кошика').waitFor({ timeout: 25_000 })

  // 17 кошик
  await tap(page, page.getByRole('link', { name: 'Кошик' }))
  await page.getByRole('heading', { name: 'Кошик', level: 1 }).waitFor()
  beat('кошик')
  // Кількість не звіряємо з конкретним рядком: склад кошика залежить від
  // того, що агент щойно додав, а перша позиція буває ваговою — тоді
  // замість «2 шт» буде «0,4 кг», і жорстка перевірка ламає весь запис.
  await tap(page, page.getByRole('button', { name: /Збільшити кількість/ }).first())
  await page.waitForTimeout(1200)
  /**
   * Зміна кількості перемальовує кошик через router.refresh(). Поки та
   * навігація в польоті, page.evaluate у scrollTo падає з «Execution context
   * was destroyed» — і весь трихвилинний запис іде намарно. Пауза в 1,2 с
   * від цього не рятує: на завантаженій машині оновлення приходить пізніше.
   */
  await page.waitForLoadState('networkidle').catch(() => {})
  await scrollTo(page, 880); await pace(page)

  // 18 спільнота
  await page.goto('/recipes/community'); await page.waitForLoadState('networkidle')
  beat('спільнота'); await scrollTo(page, 500); await pace(page)

  // 19 trace
  await page.goto('/trace')
  await page.getByRole('heading', { name: 'Як працює агент' }).waitFor()
  beat('trace'); await scrollTo(page, 420); await pace(page)

  // 20 фінал
  beat('фінал')
  await card(page,
    '<div style="font-size:66px">🧺</div>' +
    '<div style="color:#fff;font:800 26px/1.2 -apple-system,system-ui,sans-serif">Сільпо: Сімейна комора</div>' +
    '<div style="color:#ffb765;font:700 18px/1.3 -apple-system,system-ui,sans-serif">komora.im.pl.ua</div>')
  await pace(page)

  const total = (Date.now() - t0) / 1000
  await ctx.close(); await browser.close()

  // Брати НАЙНОВІШИЙ webm, а не перший-ліпший: після невдалого прогону в
  // теці лишається обрізаний файл, і find() підхоплював саме його — запис
  // виходив на 40 секунд коротшим, а помітно це лише за тривалістю.
  const webm = readdirSync(OUT)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: statSync(join(OUT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0]
  if (webm) renameSync(join(OUT, webm.f), join(OUT, 'demo-tight.webm'))
  writeFileSync('docs/demo-tight-scenes.json', JSON.stringify({ total, scenes: marks }, null, 2))

  console.log('\n  #    старт  сцена')
  marks.forEach((m) => console.log(`${(m.i + 1).toString().padStart(3)} ${m.start.toFixed(2).padStart(8)}с ${m.label}`))
  console.log(`\nвсього: ${total.toFixed(1)} с (було 218)`)
  if (over.length) {
    console.log(`\n⚠ сцени, довші за ціль (дії не встигали коротше):`)
    over.forEach((o) => console.log(`   ${o}`))
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
