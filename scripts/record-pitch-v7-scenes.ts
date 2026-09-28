/**
 * Дві нові сцени для пітчу v7 (відгук журі 28.09: «не видно обліку продуктів»).
 *
 *   R «чек» — імпорт із чеків «Сільпо» в коморі: скільки чеків, що додано,
 *     терміни й прострочене, позначене одразу.
 *   C «приготування» — «Я це приготував» → списання → комора після нього.
 *
 * Тривалість кожної сцени задає її озвучка (tutorial-out/pitch-v7-vo і
 * demo-v2-vo/11.mp3) плюс пауза; межі пишуться в docs/pitch-v7-scenes.json,
 * монтаж ріже запис саме по них.
 *
 *   npx tsx scripts/record-pitch-v7-scenes.ts   (застосунок на :3210)
 */
import { chromium, type Page, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://localhost:3210'
const OUT = 'tutorial-out'
const GAP = 0.9

const dur = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString())

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


const marks: { label: string; start: number; end: number }[] = []
let t0 = 0

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


async function hold(page: Page, since: number, sec: number) {
  const left = sec * 1000 - (Date.now() - since)
  if (left > 0) await page.waitForTimeout(left)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const wantR = dur('tutorial-out/pitch-v7-vo/04.mp3') + GAP
  const cookLine = dur('tutorial-out/demo-v2-vo/11.mp3') + 0.6
  const wantC = cookLine + dur('tutorial-out/pitch-v7-vo/06.mp3') + GAP

  const browser = await chromium.launch()
  // прогрів окремим контекстом: перші запити маршрутів не мають падати всередину сцен
  const warm = await browser.newContext({ baseURL: BASE, locale: 'uk-UA' })
  const wp = await warm.newPage()
  await wp.goto('/login')
  await wp.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }).click()
  await wp.waitForURL('**/')
  // демо до відомого стану: без цього повторний запис бачить «Нових чеків немає»
  // (сервер запущено з E2E_TEST_RESET=true, як для e2e на прод-збірці)
  const reset = await wp.request.post('/api/dev/reset')
  if (!reset.ok()) throw new Error(`скидання демо: ${reset.status()}`)
  for (const r of ['/pantry', '/recipes/frytata-zi-shpynatom?servings=2']) {
    await wp.goto(r); await wp.waitForLoadState('networkidle').catch(() => undefined)
  }
  await warm.close()

  const ctx = await browser.newContext({
    baseURL: BASE, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: { width: 390, height: 844 } }, locale: 'uk-UA',
  })
  await ctx.addInitScript(OVERLAY)
  const page = await ctx.newPage()
  t0 = Date.now()
  const at = () => (Date.now() - t0) / 1000

  // вхід у демо — не в кадрі монтажу
  await page.goto('/login')
  await page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }).click()
  await page.waitForURL('**/'); await page.getByRole('heading', { name: 'Антон' }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(800)

  // R чек
  let s = Date.now(); let start = at()
  await tap(page, page.getByRole('navigation', { name: 'Основна навігація' }).getByRole('link', { name: 'Комора' }))
  await page.getByRole('heading', { name: 'Домашня комора' }).waitFor()
  await page.waitForTimeout(700)
  await tap(page, page.getByRole('button', { name: /Імпорт із чеків/ }))
  await page.getByText(/Опрацьовано/).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(2600)
  await scrollTo(page, 430, 1500)
  await hold(page, s, wantR)
  marks.push({ label: 'чек', start, end: at() })

  // перехід до рецепта — не в кадрі
  await page.goto('/recipes/frytata-zi-shpynatom?servings=2')
  await page.getByRole('heading', { name: 'Фрітата зі шпинатом' }).waitFor()
  await scrollTo(page, 0, 600)

  // C приготування: репліка «Приготували — використане списується само», далі комора після списання
  s = Date.now(); start = at()
  await tap(page, page.getByRole('button', { name: 'Я це приготував' }))
  await page.getByText('Списати ці інгредієнти з комори?').waitFor()
  await hold(page, s, cookLine)
  await tap(page, page.getByRole('button', { name: 'Так, списати' }))
  await page.getByText('Комору оновлено').waitFor()
  await page.waitForTimeout(1600)
  await tap(page, page.getByRole('navigation', { name: 'Основна навігація' }).getByRole('link', { name: 'Комора' }))
  await page.getByRole('heading', { name: 'Домашня комора' }).waitFor()
  await page.waitForTimeout(900)
  await scrollTo(page, 430, 1500)
  await hold(page, s, wantC)
  marks.push({ label: 'приготування', start, end: at() })

  await ctx.close(); await browser.close()
  const webm = readdirSync(OUT).filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, t: statSync(join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t)[0]
  renameSync(join(OUT, webm.f), join(OUT, 'pitch-v7-scenes.webm'))
  writeFileSync('docs/pitch-v7-scenes.json', JSON.stringify({ scenes: marks }, null, 2))
  for (const m of marks) console.log(`${m.label}: ${m.start.toFixed(2)}–${m.end.toFixed(2)} с (${(m.end - m.start).toFixed(1)})`)
  console.log(`ціль: чек ${wantR.toFixed(1)} с, приготування ${wantC.toFixed(1)} с`)
}

main().catch((e) => { console.error(e); process.exit(1) })
