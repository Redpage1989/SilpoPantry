/**
 * Презентаційне відео продукту — під озвучку.
 *
 * Відрізняється від record-tutorial.ts трьома речами:
 *   1. НЕМА підписів на екрані. Текст поверх кадру конкурував би з голосом
 *      диктора: глядач або читає, або слухає, і робить це гірше вдвічі.
 *   2. Спокійніший темп із довгими зупинками — щоб на кожен екран
 *      вистачило 2–4 речень наративу.
 *   3. Скрипт друкує таймкоди кожної сцени. Це готовий сценарій озвучки:
 *      видно, на якій секунді що з'являється.
 *
 * Запуск:  npx tsx scripts/record-presentation.ts
 * Вимагає: прод-сервер на :3210 і свіжий `npm run setup`.
 */
import { chromium, type Page, type Locator } from '@playwright/test'
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://localhost:3210'
const OUT = 'tutorial-out'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAA4UlEQVR4nGNgYOXiF5GUU9bQNTK3cXTzDgiNik/JzCuuqG1q75k4bfaCpavWb9m57/CJs5eu33n47PWHr7/+s3DyCUvIKqnrGJpZO7h6+YdExiVn5BaV1zS2dU+YOmv+kpXrNu/Ye+j4mYvXbj94+ur9l5//mDl4hcRlFNW0DUyt7F08/YIjYpPScwrLqhtau/qnzJy3eMXaTdv3HDx2mmHUQaMOGnXQqINGHTTqoFEHjTpo1EGjDhp10KiDRh006qBRB406aNRBow4addCog0YdNOqgUQeNOmjUQaMOop+DAKJ6xTW+vsnbAAAAAElFTkSuQmCC'

/** Тільки палець-індикатор. Жодних текстових плашок — їх скаже диктор. */
const OVERLAY_INIT = `(() => {
  const install = () => {
    if (document.getElementById('pres-finger')) return
    const f = document.createElement('div')
    f.id = 'pres-finger'
    f.style.cssText = [
      'position:fixed','width:34px','height:34px','z-index:2147483001',
      'border:3px solid rgba(255,122,0,0.92)','background:rgba(255,170,60,0.28)',
      'border-radius:50%','transform:translate(-50%,-50%)','opacity:0',
      'transition:left 0.55s cubic-bezier(.3,.8,.3,1),top 0.55s cubic-bezier(.3,.8,.3,1),opacity 0.28s',
      'pointer-events:none',
    ].join(';')
    document.body.append(f)
  }
  if (document.readyState !== 'loading') install()
  else document.addEventListener('DOMContentLoaded', install)
})()`

/** Таймкоди сцен: із цього виходить сценарій озвучки. */
const marks: { t: number; label: string }[] = []
let t0 = 0
const fmt = (ms: number) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
function beat(label: string) {
  marks.push({ t: Date.now() - t0, label })
}

async function tap(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const box = await target.boundingBox()
  if (box) {
    await page.evaluate(
      ([px, py]) => {
        const f = document.getElementById('pres-finger')
        if (!f) return
        f.style.left = px + 'px'
        f.style.top = py + 'px'
        f.style.opacity = '1'
      },
      [box.x + box.width / 2, box.y + box.height / 2],
    )
    await page.waitForTimeout(800)
    await page.evaluate(() => {
      const f = document.getElementById('pres-finger')
      if (f) f.style.transform = 'translate(-50%,-50%) scale(0.7)'
    })
    await page.waitForTimeout(200)
    await page.evaluate(() => {
      const f = document.getElementById('pres-finger')
      if (f) f.style.transform = 'translate(-50%,-50%) scale(1)'
    })
  }
  await target.click()
  await page.evaluate(() => {
    const f = document.getElementById('pres-finger')
    if (f) f.style.opacity = '0'
  })
}

async function scrollTo(page: Page, y: number, settle = 1800) {
  await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y)
  await page.waitForTimeout(settle)
}

/** Титр на весь екран — лише на початку й у кінці. */
async function card(page: Page, html: string, holdMs: number) {
  await page.evaluate((inner) => {
    const o = document.createElement('div')
    o.id = 'pres-card'
    o.style.cssText = [
      'position:fixed','inset:0','z-index:2147483100','background:#16161c',
      'display:flex','flex-direction:column','align-items:center','justify-content:center',
      'gap:16px','opacity:0','transition:opacity 0.8s ease','text-align:center','padding:28px',
    ].join(';')
    o.innerHTML = inner
    document.body.append(o)
    requestAnimationFrame(() => (o.style.opacity = '1'))
  }, html)
  await page.waitForTimeout(holdMs)
  await page.evaluate(() => {
    const o = document.getElementById('pres-card')
    if (o) o.style.opacity = '0'
  })
  await page.waitForTimeout(900)
  await page.evaluate(() => document.getElementById('pres-card')?.remove())
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: { width: 390, height: 844 } },
    locale: 'uk-UA',
  })
  await context.addInitScript(OVERLAY_INIT)
  const page = await context.newPage()
  t0 = Date.now()

  // ── Титр ───────────────────────────────────────────────────────────────
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  beat('Титр: «Сільпо: Сімейна комора»')
  await card(
    page,
    '<div style="font-size:70px">🧺</div>' +
      '<div style="color:#fff;font:800 27px/1.2 -apple-system,system-ui,sans-serif">Сільпо: Сімейна комора</div>' +
      '<div style="color:#9a9aa5;font:400 15px/1.5 -apple-system,system-ui,sans-serif;max-width:300px">AI-агент на офіційному MCP «Сільпо»</div>',
    6500,
  )

  // ── Вхід ───────────────────────────────────────────────────────────────
  beat('Екран входу: які дані використовує застосунок')
  await page.waitForTimeout(4500)
  await scrollTo(page, 260)
  await page.waitForTimeout(3000)
  await scrollTo(page, 0, 1200)
  await tap(page, page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }))
  await page.waitForURL('**/')
  await page.getByRole('heading', { name: 'Антон' }).waitFor({ timeout: 30_000 })

  // ── Головна ────────────────────────────────────────────────────────────
  beat('Головна: що приготувати сьогодні')
  await page.waitForTimeout(6000)
  await scrollTo(page, 430)
  beat('Продукти, що псуються — шпинат «до завтра»')
  await page.waitForTimeout(6500)
  await scrollTo(page, 0, 1200)

  // ── Сканування ─────────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Сканувати' }))
  await page.getByRole('heading', { name: 'Сканування' }).waitFor()
  beat('Сканування: фото холодильника наповнює комору')
  await page.waitForTimeout(5000)
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="scan-file-input"]')
    return !!el && Object.keys(el).some((k) => k.startsWith('__react'))
  })
  await page.getByTestId('scan-file-input').setInputFiles({
    name: 'fridge.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  await page.getByText(/Фото до аналізу: 1/).waitFor()
  await page.waitForTimeout(1400)
  await tap(page, page.getByRole('button', { name: 'Розпізнати продукти' }))
  await page.getByText(/Підтвердіть розпізнане/).waitFor({ timeout: 20_000 })
  beat('Підтвердження: нічого не зберігається без людини')
  await page.waitForTimeout(6500)
  await scrollTo(page, 400)
  await page.waitForTimeout(3500)
  await tap(page, page.getByRole('button', { name: /Підтвердити та зберегти/ }))
  await page.getByText(/Додано до комори:/).waitFor()
  await page.waitForTimeout(2500)

  // ── Комора ─────────────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Комора' }))
  await page.waitForURL('**/pantry')
  await page.getByRole('heading', { name: 'Домашня комора' }).waitFor()
  beat('Комора: місця зберігання, терміни, на скільки вистачить')
  await page.waitForTimeout(6000)
  await scrollTo(page, 520)
  await page.waitForTimeout(5000)
  await scrollTo(page, 0, 1200)

  // ── Рецепти ────────────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Рецепти' }))
  await page.getByRole('heading', { name: 'Що можна приготувати?' }).waitFor()
  await page.waitForTimeout(2200)
  await tap(page, page.getByRole('button', { name: 'Підібрати страви' }))
  const why = page.getByRole('button', { name: 'Чому саме ця страва?' })
  await why.first().waitFor({ timeout: 20_000 })
  beat('Підбір страв із того, що вже вдома')
  await page.waitForTimeout(6500)
  await tap(page, why.first())
  await page.getByText(/Підсумковий бал:/).waitFor()
  beat('Прозорий скоринг: чому саме ця страва')
  await page.waitForTimeout(7000)

  // ── Рецепт і списання ──────────────────────────────────────────────────
  await page.goto('/recipes/frytata-zi-shpynatom?servings=2')
  await page.getByRole('heading', { name: 'Фрітата зі шпинатом' }).waitFor()
  beat('Рецепт знає комору: «є вдома» проти «докупити»')
  await page.waitForTimeout(6000)
  await scrollTo(page, 720)
  await page.waitForTimeout(4000)
  await tap(page, page.getByRole('button', { name: 'Я це приготував' }))
  await page.getByText('Списати ці інгредієнти з комори?').waitFor()
  beat('Списання після готування')
  await page.waitForTimeout(4500)
  await tap(page, page.getByRole('button', { name: 'Так, списати' }))
  await page.getByText('Комору оновлено').waitFor()
  await page.waitForTimeout(2500)

  // ── «Хочу тірамісу» ────────────────────────────────────────────────────
  await page.goto('/')
  const query = page.getByLabel('Що ви хочете приготувати')
  await query.waitFor()
  beat('Ключовий сценарій: «Хочу тірамісу»')
  await page.waitForTimeout(3500)
  await tap(page, query)
  await query.pressSequentially('Тірамісу', { delay: 130 })
  await page.waitForTimeout(900)
  await tap(page, page.getByRole('button', { name: 'Знайти' }))
  await page.getByRole('heading', { name: 'Тірамісу' }).waitFor({ timeout: 25_000 })
  beat('Агент звірив комору й знайшов, чого бракує')
  await page.waitForTimeout(5500)
  await scrollTo(page, 720)
  beat('Три цінові рівні з реальними цінами «Сільпо»')
  await page.waitForTimeout(7000)
  await scrollTo(page, 1520)
  beat('Готувати вдома чи купити готове — чесне порівняння')
  await page.waitForTimeout(7500)
  await tap(page, page.getByRole('button', { name: 'Додати до кошика' }))
  await page.getByText('Підтвердіть зміну кошика').waitFor()
  beat('Кошик не змінюється без явного підтвердження')
  await page.waitForTimeout(6000)
  await tap(page, page.getByRole('button', { name: 'Так, додати' }))
  await page.getByText('Товари додано до кошика').waitFor({ timeout: 25_000 })
  await page.waitForTimeout(3000)

  // ── Кошик ──────────────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Кошик' }))
  await page.getByRole('heading', { name: 'Кошик', level: 1 }).waitFor()
  beat('Кошик зібрано: суми, балабонуси, доставка')
  await page.waitForTimeout(5000)
  await tap(page, page.getByRole('button', { name: /Збільшити кількість/ }).first())
  await page.getByText(/^2 шт$/).first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(2200)
  await scrollTo(page, 900)
  await page.waitForTimeout(5000)

  // ── Спільнота ──────────────────────────────────────────────────────────
  await page.goto('/recipes/community')
  await page.waitForLoadState('networkidle')
  beat('Рецепти від родин і приз за рецепт тижня')
  await page.waitForTimeout(5500)
  await scrollTo(page, 520)
  await page.waitForTimeout(5000)

  // ── Технічний екран ────────────────────────────────────────────────────
  await page.goto('/trace')
  await page.getByRole('heading', { name: 'Як працює агент' }).waitFor()
  beat('/trace: кожен крок агента й виклики MCP видно')
  await page.waitForTimeout(6000)
  await scrollTo(page, 430)
  await page.waitForTimeout(5500)

  // ── Фінальний титр ─────────────────────────────────────────────────────
  beat('Фінальний титр: komora.im.pl.ua')
  await card(
    page,
    '<div style="font-size:66px">🧺</div>' +
      '<div style="color:#fff;font:800 26px/1.2 -apple-system,system-ui,sans-serif">Сільпо: Сімейна комора</div>' +
      '<div style="color:#ffb765;font:700 18px/1.3 -apple-system,system-ui,sans-serif">komora.im.pl.ua</div>' +
      '<div style="color:#9a9aa5;font:400 13px/1.5 -apple-system,system-ui,sans-serif;max-width:290px">Hackathon prototype для «Сільпо» AI Factory.<br>Не є офіційним продуктом ТОВ «Сільпо».</div>',
    7000,
  )

  const total = Date.now() - t0
  await context.close()
  await browser.close()

  const webm = readdirSync(OUT).find((f) => f.endsWith('.webm') && !f.includes('tutorial'))
  if (webm) renameSync(join(OUT, webm), join(OUT, 'presentation.webm'))

  const lines = [
    '# Сценарій озвучки — презентаційне відео',
    '',
    `Тривалість запису: ${fmt(total)}. Таймкоди — момент, коли сцена з'являється.`,
    'Текст під кожним таймкодом — підказка, про що говорити; формулюйте своїми словами.',
    '',
    '| Таймкод | Що на екрані |',
    '|---|---|',
    ...marks.map((m) => `| **${fmt(m.t)}** | ${m.label} |`),
    `| **${fmt(total)}** | кінець |`,
    '',
  ].join('\n')
  writeFileSync('docs/VOICEOVER_SCRIPT.md', lines)
  console.log(lines)
  console.log('✅ tutorial-out/presentation.webm + docs/VOICEOVER_SCRIPT.md')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
