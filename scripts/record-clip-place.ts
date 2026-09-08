/**
 * Кліп-доповнення до демо: поле «Де придбали» → метрика частки «Сільпо» →
 * плюси застосунку. Сцени тримаються рівно під свою репліку з
 * tutorial-out/clip-vo/NN.mp3 (той самий принцип, що в record-tight.ts).
 *
 *   npx tsx scripts/record-clip-place.ts   →  tutorial-out/clip-place.webm
 *                                              docs/clip-place-scenes.json
 */
import { chromium, type Page, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://localhost:3210'
const OUT = 'tutorial-out'
const VO = join(OUT, 'clip-vo')
const GAP = 0.9

const dur = (f: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())
const TARGETS = readdirSync(VO).filter((f) => f.endsWith('.mp3')).sort().map((f) => dur(join(VO, f)) + GAP)

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

let t0 = 0, sceneAt = 0, idx = -1
const marks: { i: number; start: number; label: string }[] = []
const over: string[] = []

function beat(label: string) {
  const now = Date.now()
  if (idx >= 0) {
    const actual = (now - sceneAt) / 1000, want = TARGETS[idx]
    if (actual > want + 0.35) over.push(`${idx + 1} «${marks[idx].label}» ${actual.toFixed(1)} с проти ${want.toFixed(1)}`)
  }
  idx += 1; sceneAt = now
  marks.push({ i: idx, start: (now - t0) / 1000, label })
}
async function pace(page: Page) {
  const left = TARGETS[idx] * 1000 - (Date.now() - sceneAt)
  if (left > 0) await page.waitForTimeout(left)
}
async function finger(page: Page, t: Locator) {
  await t.scrollIntoViewIfNeeded(); await page.waitForTimeout(250)
  const b = await t.boundingBox()
  if (!b) return
  await page.evaluate(([x, y]) => {
    const f = document.getElementById('pres-finger'); if (!f) return
    f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.opacity = '1'
  }, [b.x + b.width / 2, b.y + b.height / 2])
  await page.waitForTimeout(600)
}
async function unfinger(page: Page) {
  await page.evaluate(() => { const f = document.getElementById('pres-finger'); if (f) f.style.opacity = '0' })
}
async function tap(page: Page, t: Locator) { await finger(page, t); await t.click(); await unfinger(page) }
async function card(page: Page, inner: string) {
  await page.evaluate((h) => {
    const o = document.createElement('div'); o.id = 'pres-card'
    o.style.cssText = ['position:fixed','inset:0','z-index:2147483100','background:#16161c',
      'display:flex','flex-direction:column','align-items:center','justify-content:center',
      'gap:16px','opacity:0','transition:opacity 0.6s ease','text-align:center','padding:28px'].join(';')
    o.innerHTML = h; document.body.append(o)
    requestAnimationFrame(() => (o.style.opacity = '1'))
  }, inner)
}
async function uncard(page: Page) {
  await page.evaluate(() => { const o = document.getElementById('pres-card'); if (o) o.style.opacity = '0' })
  await page.waitForTimeout(400)
  await page.evaluate(() => document.getElementById('pres-card')?.remove())
}

const F = '-apple-system,system-ui,sans-serif'
const bullet = (emoji: string, t: string) =>
  `<div style="display:flex;gap:14px;align-items:flex-start;text-align:left;width:100%;max-width:330px">` +
  `<div style="font-size:26px;line-height:1.1">${emoji}</div>` +
  `<div style="color:#fff;font:600 17px/1.35 ${F}">${t}</div></div>`

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: { width: 390, height: 844 } }, locale: 'uk-UA',
  })
  await ctx.addInitScript(OVERLAY)

  // прогрів окремим контекстом, щоб сцени не ловили холодні маршрути
  const warm = await browser.newContext({ baseURL: BASE, locale: 'uk-UA' })
  const wp = await warm.newPage()
  await wp.goto('/login')
  await wp.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }).click()
  await wp.waitForURL('**/')
  for (const r of ['/pantry', '/metrics']) { await wp.goto(r); await wp.waitForLoadState('networkidle') }
  await warm.close()

  const page = await ctx.newPage()
  // відлік — від старту запису (recordVideo починається з newPage), а не після
  // входу: інакше репліки лягали на кілька секунд раніше за картинку.
  // Вхід і перехід у комору — «підвід», який монтаж відрізає за start сцени 1.
  t0 = Date.now()
  await page.goto('/login')
  await page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }).click()
  await page.waitForURL('**/')
  await page.goto('/pantry')
  await page.getByRole('heading', { name: 'Домашня комора' }).waitFor()
  await page.waitForLoadState('networkidle')

  // 1 «Де придбали»
  beat('де придбали')
  await page.waitForTimeout(900)
  await tap(page, page.getByRole('button', { name: /Додати вручну/ }))
  const name = page.locator('#m-name')
  await name.waitFor()
  await tap(page, name)
  await name.pressSequentially('Яблука', { delay: 70 })
  const qty = page.locator('#m-qty')
  await qty.fill('6')
  const place = page.locator('#m-place')
  await finger(page, place)
  await place.selectOption('market')
  await page.waitForTimeout(1400)
  await unfinger(page)
  // дотик — ДО вирівнювання: оновлення списку після запису йде кілька
  // секунд, і після репліки вони ставали тишею (19 с проти 12 у першому дублі)
  await tap(page, page.getByRole('button', { name: 'Додати до комори' }))
  await page.getByText('Яблука').first().waitFor({ timeout: 15_000 })
  await pace(page)

  // 2 метрика
  await page.goto('/metrics')
  await page.getByRole('heading', { name: 'Що змінилось' }).waitFor()
  beat('метрика')
  const share = page.getByText(/Куплено в «Сільпо»/)
  await share.waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  await share.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  await finger(page, share)
  await pace(page)
  await unfinger(page)

  // 3 плюси
  beat('плюси')
  await card(page,
    `<div style="color:#ffb765;font:800 22px/1.2 ${F};margin-bottom:6px">Що агент робить, а не радить</div>` +
    bullet('🧾', 'Знає, що вдома — з чеків «Сільпо» і фото полиці') +
    bullet('🍳', 'Списує з комори після готування') +
    bullet('⚖️', 'Чесно каже, коли готове дешевше за готування') +
    bullet('🛒', 'Кладе в кошик лише після вашого підтвердження'))
  await pace(page); await uncard(page)

  // 4 фінал
  beat('фінал')
  await card(page,
    `<img src="/icon-192.png" width="120" height="120" style="border-radius:28px" alt="">` +
    `<div style="color:#fff;font:800 26px/1.2 ${F}">Сільпо: Сімейна комора</div>` +
    `<div style="color:#d8d8de;font:500 16px/1.4 ${F};max-width:300px">Уже тестується на реальних покупцях «Сільпо»</div>` +
    `<div style="color:#ffb765;font:700 18px/1.3 ${F}">komora.im.pl.ua</div>`)
  await pace(page)

  const total = (Date.now() - t0) / 1000
  await ctx.close(); await browser.close()
  const webm = readdirSync(OUT).filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: statSync(join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]
  if (webm) renameSync(join(OUT, webm.f), join(OUT, 'clip-place.webm'))
  writeFileSync('docs/clip-place-scenes.json', JSON.stringify({ total, scenes: marks }, null, 2))
  marks.forEach((m) => console.log(`${m.i + 1} ${m.start.toFixed(2)}с ${m.label}`))
  console.log(`всього: ${total.toFixed(1)} с`)
  if (over.length) { console.log('⚠ довші за ціль:'); over.forEach((o) => console.log('  ' + o)) }
}
main().catch((e) => { console.error(e); process.exit(1) })
