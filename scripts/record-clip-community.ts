/**
 * Кліп-доповнення до демо: рецепти спільноти → зароблений голос →
 * таблиця тижня. Сцени тримаються рівно під свою репліку з
 * tutorial-out/clip-community-vo/NN.mp3 (той самий принцип, що в
 * record-tight.ts).
 *
 *   npx tsx scripts/record-clip-community.ts → tutorial-out/clip-community.webm
 *                                              docs/clip-community-scenes.json
 */
import { chromium, type Page, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://localhost:3210'
const OUT = 'tutorial-out'
const VO = join(OUT, 'clip-community-vo')
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
async function scrollTo(page: Page, y: number, settle = 1300) {
  await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y)
  await page.waitForTimeout(settle)
}

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
  // відлік — від старту запису; вхід у демо це «підвід», який монтаж відрізає
  t0 = Date.now()
  await page.goto('/login')
  await page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }).click()
  await page.waitForURL('**/')
  await page.goto('/recipes/community')
  await page.getByRole('heading', { name: 'Рецепти спільноти' }).waitFor()
  await page.waitForLoadState('networkidle')

  // 1 стрічка: голос ще не зароблений
  beat('стрічка')
  const target = page.getByRole('heading', { name: 'Сирники з родзинками' })
  await target.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const hint = page.getByText('голосувати може той, хто готував').first()
  await finger(page, hint)
  await pace(page)
  await unfinger(page)

  // 2 рецепт спільноти: покриття коморою
  await tap(page, page.getByRole('link', { name: 'Приготувати →' }).first())
  await page.waitForURL('**/recipes/community/**')
  await page.getByRole('heading', { name: 'Сирники з родзинками' }).waitFor()
  beat('рецепт')
  await scrollTo(page, 420)
  await pace(page)

  // 3 приготування списує комору
  beat('приготування')
  await scrollTo(page, 0, 700)
  await tap(page, page.getByRole('button', { name: /Я це приготував/ }))
  await page.getByText(/Списати ці інгредієнти з комори/).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(1200)
  await tap(page, page.getByRole('button', { name: 'Так, списати' }))
  await page.getByText('Комору оновлено').waitFor({ timeout: 20_000 })
  await pace(page)

  // 4 зароблений голос і таблиця тижня
  await page.goto('/recipes/community')
  await page.getByRole('heading', { name: 'Рецепти спільноти' }).waitFor()
  await page.waitForLoadState('networkidle')
  beat('голос і таблиця')
  const voteBtn = page.getByRole('button', { name: '☆ Голосувати' }).first()
  await voteBtn.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await tap(page, voteBtn)
  await page.getByRole('button', { name: '★ Проголосовано' }).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(900)
  await scrollTo(page, 0, 900)
  const board = page.getByRole('heading', { name: 'Таблиця тижня' })
  await board.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await finger(page, board)
  await pace(page)
  await unfinger(page)

  const total = (Date.now() - t0) / 1000
  await ctx.close(); await browser.close()
  const webm = readdirSync(OUT).filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: statSync(join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]
  if (webm) renameSync(join(OUT, webm.f), join(OUT, 'clip-community.webm'))
  writeFileSync('docs/clip-community-scenes.json', JSON.stringify({ total, scenes: marks }, null, 2))
  marks.forEach((m) => console.log(`${m.i + 1} ${m.start.toFixed(2)}с ${m.label}`))
  console.log(`всього: ${total.toFixed(1)} с`)
  if (over.length) { console.log('⚠ довші за ціль:'); over.forEach((o) => console.log('  ' + o)) }
}
main().catch((e) => { console.error(e); process.exit(1) })
