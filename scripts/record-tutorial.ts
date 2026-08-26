/**
 * Запис відео-туторіалу користування застосунком.
 *
 * Іде тим самим маршрутом, що й E2E, але в темпі людини: з паузами,
 * анімованим «пальцем» на місці кліків і підписами-поясненнями внизу
 * екрана. Селектори взяті з e2e/demo-flow.spec.ts — вони перевірені.
 *
 * Запуск:  npx tsx scripts/record-tutorial.ts
 * Вимагає: прод-сервер на :3210 і свіжий `npm run setup`.
 * Результат: tutorial-out/tutorial.webm + скріншоти для README.
 */
import { chromium, type Page, type Locator } from '@playwright/test'
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://localhost:3210'
const OUT = 'tutorial-out'
const SHOTS = 'docs/screenshots'

/** Той самий валідний PNG 48×48, що і в E2E: сервер перевіряє сигнатуру. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAA4UlEQVR4nGNgYOXiF5GUU9bQNTK3cXTzDgiNik/JzCuuqG1q75k4bfaCpavWb9m57/CJs5eu33n47PWHr7/+s3DyCUvIKqnrGJpZO7h6+YdExiVn5BaV1zS2dU+YOmv+kpXrNu/Ye+j4mYvXbj94+ur9l5//mDl4hcRlFNW0DUyt7F08/YIjYpPScwrLqhtau/qnzJy3eMXaTdv3HDx2mmHUQaMOGnXQqINGHTTqoFEHjTpo1EGjDhp10KiDRh006qBRB406aNRBow4addCog0YdNOqgUQeNOmjUQaMOop+DAKJ6xTW+vsnbAAAAAElFTkSuQmCC'

/** Оверлеї (підпис + палець) перевстановлюються на кожній навігації. */
const OVERLAY_INIT = `(() => {
  const install = () => {
    if (document.getElementById('tut-caption')) return
    const c = document.createElement('div')
    c.id = 'tut-caption'
    c.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:92px', 'z-index:2147483000',
      'background:rgba(22,22,28,0.93)', 'color:#fff', 'padding:13px 15px',
      'border-radius:16px', 'font:500 14.5px/1.45 -apple-system,system-ui,sans-serif',
      'box-shadow:0 8px 28px rgba(0,0,0,0.35)', 'opacity:0',
      'transition:opacity 0.35s ease', 'pointer-events:none',
    ].join(';')
    const f = document.createElement('div')
    f.id = 'tut-finger'
    f.style.cssText = [
      'position:fixed', 'width:32px', 'height:32px', 'z-index:2147483001',
      'border:3px solid rgba(255,122,0,0.9)', 'background:rgba(255,170,60,0.3)',
      'border-radius:50%', 'transform:translate(-50%,-50%)', 'opacity:0',
      'transition:left 0.5s cubic-bezier(.3,.8,.3,1),top 0.5s cubic-bezier(.3,.8,.3,1),opacity 0.25s',
      'pointer-events:none',
    ].join(';')
    document.body.append(c, f)
  }
  if (document.readyState !== 'loading') install()
  else document.addEventListener('DOMContentLoaded', install)
})()`

async function caption(page: Page, title: string, text: string, holdMs: number) {
  await page.evaluate(
    ([t, x]) => {
      const c = document.getElementById('tut-caption')
      if (!c) return
      c.innerHTML =
        '<div style="font-weight:700;font-size:15.5px;margin-bottom:3px">' + t + '</div>' + x
      c.style.opacity = '1'
    },
    [title, text],
  )
  await page.waitForTimeout(holdMs)
}

async function hideOverlays(page: Page) {
  await page.evaluate(() => {
    for (const id of ['tut-caption', 'tut-finger']) {
      const el = document.getElementById(id)
      if (el) el.style.opacity = '0'
    }
  })
  await page.waitForTimeout(400)
}

/** Палець підлітає до елемента, пульсує — і лише потім клік. */
async function tap(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  await page.waitForTimeout(350)
  const box = await target.boundingBox()
  if (box) {
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.evaluate(
      ([px, py]) => {
        const f = document.getElementById('tut-finger')
        if (!f) return
        f.style.left = px + 'px'
        f.style.top = py + 'px'
        f.style.opacity = '1'
      },
      [x, y],
    )
    await page.waitForTimeout(750)
    await page.evaluate(() => {
      const f = document.getElementById('tut-finger')
      if (f) f.style.transform = 'translate(-50%,-50%) scale(0.72)'
    })
    await page.waitForTimeout(180)
    await page.evaluate(() => {
      const f = document.getElementById('tut-finger')
      if (f) f.style.transform = 'translate(-50%,-50%) scale(1)'
    })
  }
  await target.click()
  await page.evaluate(() => {
    const f = document.getElementById('tut-finger')
    if (f) f.style.opacity = '0'
  })
}

async function smoothScroll(page: Page, toY: number, settleMs = 1600) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), toY)
  await page.waitForTimeout(settleMs)
}

async function shot(page: Page, name: string) {
  await hideOverlays(page)
  await page.screenshot({ path: join(SHOTS, name) })
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  mkdirSync(SHOTS, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: { width: 780, height: 1688 } },
    locale: 'uk-UA',
  })
  await context.addInitScript(OVERLAY_INIT)
  const page = await context.newPage()

  // ── 1. Вхід ────────────────────────────────────────────────────────────
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
  await caption(
    page, '🧺 «Сільпо: Сімейна комора»',
    'AI-агент, який веде домашню комору, планує меню родини і збирає кошик у «Сільпо». Подивімось, як ним користуватись.',
    4600,
  )
  await caption(
    page, 'Крок 1 — вхід',
    'Можна увійти через «Сільпо» або спробувати демонстраційний режим — без реєстрації і ключів.',
    3800,
  )
  await tap(page, page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }))
  await page.waitForURL('**/')
  await page.getByRole('heading', { name: 'Антон' }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(600)

  // ── 2. Головна ─────────────────────────────────────────────────────────
  await caption(
    page, 'Головна — лише головне',
    'Що приготувати сьогодні і що псується. Агент уже врахував склад родини, алергії та вміст комори.',
    4600,
  )
  await smoothScroll(page, 420)
  await caption(
    page, 'Продукти, що псуються',
    'Шпинат треба використати до завтра — тому агент запропонує страви саме з ним.',
    4200,
  )
  await shot(page, 'home.png')
  await smoothScroll(page, 0, 900)

  // ── 3. Сканування ──────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Сканувати' }))
  await page.getByRole('heading', { name: 'Сканування' }).waitFor()
  await caption(
    page, 'Крок 2 — наповніть комору',
    'Сфотографуйте холодильник або полицю — агент розпізнає продукти. Можна й відсканувати штрихкод.',
    4600,
  )
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
  await page.waitForTimeout(700)
  await tap(page, page.getByRole('button', { name: 'Розпізнати продукти' }))
  await page.getByText(/Підтвердіть розпізнане/).waitFor({ timeout: 20_000 })
  await caption(
    page, 'Нічого не зберігається без вас',
    'Розпізнане треба підтвердити. Рівень упевненості показано словами: «точно», «приблизно», «варто перевірити».',
    5200,
  )
  await smoothScroll(page, 380)
  await tap(page, page.getByRole('button', { name: /Підтвердити та зберегти/ }))
  await page.getByText(/Додано до комори:/).waitFor()
  await page.waitForTimeout(1600)

  // ── 4. Комора ──────────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Комора' }))
  await page.waitForURL('**/pantry')
  await page.getByRole('heading', { name: 'Домашня комора' }).waitFor()
  await caption(
    page, 'Крок 3 — домашня комора',
    'Усе, що вдома: за місцями зберігання й терміном придатності. Видно, на скільки днів вистачить їжі та яких базових продуктів бракує.',
    5400,
  )
  await smoothScroll(page, 500)
  await page.waitForTimeout(800)
  await shot(page, 'pantry.png')
  await smoothScroll(page, 0, 900)

  // ── 5. Рецепти ─────────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Рецепти' }))
  await page.getByRole('heading', { name: 'Що можна приготувати?' }).waitFor()
  await caption(
    page, 'Крок 4 — що приготувати',
    'Агент підбирає страви з того, що вже є, і рятує продукти, які псуються.',
    4200,
  )
  await tap(page, page.getByRole('button', { name: 'Підібрати страви' }))
  const why = page.getByRole('button', { name: 'Чому саме ця страва?' })
  await why.first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(900)
  await caption(
    page, 'Прозорий скоринг',
    'Кожна порада пояснюється. Торкніться «Чому саме ця страва?» — і побачите бали за кожен критерій.',
    4600,
  )
  await tap(page, why.first())
  await page.getByText(/Підсумковий бал:/).waitFor()
  await page.waitForTimeout(2600)

  // ── 6. Рецепт і списання ───────────────────────────────────────────────
  await page.goto('/recipes/frytata-zi-shpynatom?servings=2')
  await page.getByRole('heading', { name: 'Фрітата зі шпинатом' }).waitFor()
  await caption(
    page, 'Рецепт знає вашу комору',
    'Інгредієнти поділені на «є вдома» і «треба докупити». Кроки — з таймерами.',
    4600,
  )
  await smoothScroll(page, 700)
  await caption(
    page, 'Після готування',
    '«Я це приготував» — і агент спише використані продукти з комори.',
    3800,
  )
  await tap(page, page.getByRole('button', { name: 'Я це приготував' }))
  await page.getByText('Списати ці інгредієнти з комори?').waitFor()
  await page.waitForTimeout(1200)
  await tap(page, page.getByRole('button', { name: 'Так, списати' }))
  await page.getByText('Комору оновлено').waitFor()
  await page.waitForTimeout(1600)

  // ── 7. «Хочу тірамісу» ─────────────────────────────────────────────────
  await page.goto('/')
  await page.getByLabel('Що ви хочете приготувати').waitFor()
  await caption(
    page, 'Крок 5 — «Хочу тірамісу»',
    'Назвіть страву — агент перевірить комору й знайде все, чого бракує, у каталозі «Сільпо».',
    4600,
  )
  const query = page.getByLabel('Що ви хочете приготувати')
  await query.scrollIntoViewIfNeeded()
  await tap(page, query)
  await query.pressSequentially('Тірамісу', { delay: 110 })
  await page.waitForTimeout(500)
  await tap(page, page.getByRole('button', { name: 'Знайти' }))
  await page.getByRole('heading', { name: 'Тірамісу' }).waitFor({ timeout: 25_000 })
  await page.waitForTimeout(800)
  await caption(
    page, 'Три цінові рівні',
    'Для кожного інгредієнта — бюджетний, оптимальний і преміальний варіанти з реальними цінами.',
    5000,
  )
  await smoothScroll(page, 700)
  await shot(page, 'dish.png')
  await smoothScroll(page, 1500)
  await caption(
    page, 'Готувати чи купити готове?',
    'Агент чесно порівнює: скільки коштує приготувати вдома і скільки — готовий десерт із каталогу.',
    5000,
  )
  const addBtn = page.getByRole('button', { name: 'Додати до кошика' })
  await tap(page, addBtn)
  await page.getByText('Підтвердіть зміну кошика').waitFor()
  await caption(
    page, 'Кошик не змінюється мовчки',
    'Агент нічого не купує сам: спершу показує, що саме і за скільки, і чекає підтвердження.',
    4600,
  )
  await tap(page, page.getByRole('button', { name: 'Так, додати' }))
  await page.getByText('Товари додано до кошика').waitFor({ timeout: 25_000 })
  await page.waitForTimeout(2000)

  // ── 8. Кошик ───────────────────────────────────────────────────────────
  await tap(page, page.getByRole('link', { name: 'Кошик' }))
  await page.getByRole('heading', { name: 'Кошик', level: 1 }).waitFor()
  await caption(
    page, 'Крок 6 — кошик зібрано',
    'Кількість можна змінити просто тут. Нижче — балабонуси, купони, акції та слоти доставки.',
    5000,
  )
  await tap(page, page.getByRole('button', { name: /Збільшити кількість/ }).first())
  await page.getByText(/^2 шт$/).first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1200)
  await smoothScroll(page, 900)
  await page.waitForTimeout(600)
  await shot(page, 'cart.png')
  await caption(
    page, 'Оформлення — у «Сільпо»',
    'Оплата й доставка лишаються в офіційному застосунку: агент передає зібраний кошик за посиланням.',
    4600,
  )

  // ── 9. Спільнота ───────────────────────────────────────────────────────
  await page.goto('/recipes/community')
  await page.waitForLoadState('networkidle')
  await caption(
    page, 'Рецепти від родин',
    'Діліться своїми рецептами й голосуйте. Автор рецепта тижня отримує 500 балабонусів.',
    4800,
  )
  await smoothScroll(page, 500)

  // ── 10. Технічний екран ────────────────────────────────────────────────
  await page.goto('/trace')
  await page.getByRole('heading', { name: 'Як працює агент' }).waitFor()
  await caption(
    page, 'Для допитливих — /trace',
    'Кожен крок агента видно: які інструменти MCP «Сільпо» викликались і навіщо. Тут же — вихід і видалення даних.',
    5200,
  )
  await smoothScroll(page, 400)
  await page.waitForTimeout(800)

  // ── Фінальна картка ────────────────────────────────────────────────────
  await hideOverlays(page)
  await page.evaluate(() => {
    const o = document.createElement('div')
    o.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483100', 'background:#16161c',
      'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
      'gap:14px', 'opacity:0', 'transition:opacity 0.7s ease', 'text-align:center', 'padding:24px',
    ].join(';')
    o.innerHTML =
      '<div style="font-size:64px">🧺</div>' +
      '<div style="color:#fff;font:800 26px/1.2 -apple-system,system-ui,sans-serif">Сільпо: Сімейна комора</div>' +
      '<div style="color:#ffb765;font:600 17px/1.3 -apple-system,system-ui,sans-serif">komora.im.pl.ua</div>' +
      '<div style="color:#9a9aa5;font:400 13.5px/1.5 -apple-system,system-ui,sans-serif;max-width:280px">Hackathon prototype для «Сільпо» AI Factory. Не є офіційним продуктом ТОВ «Сільпо».</div>'
    document.body.append(o)
    requestAnimationFrame(() => (o.style.opacity = '1'))
  })
  await page.waitForTimeout(4200)

  await context.close()
  await browser.close()

  // Playwright дає відео випадкове ім'я — перейменовуємо на стале
  const webm = readdirSync(OUT).find((f) => f.endsWith('.webm'))
  if (webm) renameSync(join(OUT, webm), join(OUT, 'tutorial.webm'))
  console.log('✅ Відео: tutorial-out/tutorial.webm · скріншоти: docs/screenshots/')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
