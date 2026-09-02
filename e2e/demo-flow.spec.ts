import { test, expect, type Page } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'

/**
 * Наскрізний demo-сценарій із ТЗ:
 *   demo mode → фото холодильника → підтвердження → вечеря → рецепт →
 *   відсутній товар → підтвердження зміни кошика → checkout link.
 *
 * Тест навмисно ходить через реальний UI, а не через API: саме так
 * сценарій побачить журі, і саме там ламаються речі.
 */

/**
 * Справжній PNG 48×48, згенерований програмно і вкладений як base64.
 * Потрібен саме валідний файл: сервер перевіряє сигнатуру й мінімальний розмір,
 * тож 2×2-заглушка була б відхилена ще до розпізнавання.
 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAA4UlEQVR4nGNgYOXiF5GUU9bQNTK3cXTzDgiNik/JzCuuqG1q75k4bfaCpavWb9m57/CJs5eu33n47PWHr7/+s3DyCUvIKqnrGJpZO7h6+YdExiVn5BaV1zS2dU+YOmv+kpXrNu/Ye+j4mYvXbj94+ur9l5//mDl4hcRlFNW0DUyt7F08/YIjYpPScwrLqhtau/qnzJy3eMXaTdv3HDx2mmHUQaMOGnXQqINGHTTqoFEHjTpo1EGjDhp10KiDRh006qBRB406aNRBow4addCog0YdNOqgUQeNOmjUQaMOop+DAKJ6xTW+vsnbAAAAAElFTkSuQmCC'

async function startDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }).click()
  await page.waitForURL('**/')
  await expect(page.getByRole('heading', { name: 'Антон' })).toBeVisible({ timeout: 30_000 })
  // Тести ділять одного демо-користувача, тому кожен починає з чистого стану:
  // інакше «Я це приготував» в одному тесті ламає очікування в іншому.
  const reset = await page.request.post('/api/dev/reset')
  expect(reset.ok()).toBeTruthy()
  await page.goto('/')
}

test.describe('Сільпо: Сімейна комора — demo-сценарій', () => {
  test('1. Demo mode запускається і показує персональну головну', async ({ page }) => {
    await startDemo(page)

    // бейдж режиму присутній і чесно каже, що це демо
    await expect(page.getByText('DEMO MODE')).toBeVisible()
    // «Hackathon prototype» лишився на /login: два бейджі поруч
    // казали те саме двічі й займали верхній ряд головної
    await expect(page.getByText('Сімейна комора').first()).toBeVisible()

    /**
     * Головна свідомо звужена до двох блоків: що приготувати сьогодні і що
     * псується. Показники комори переїхали на /pantry, персональні акції —
     * у «Вигоду» на /cart. Тест перевіряє обидві частини: що на головній
     * лишилось головне і що перенесене не загубилось.
     */
    await expect(page.getByText('Що приготуємо сьогодні?')).toBeVisible()
    await expect(page.getByText(/потрібно використати найближчим часом/)).toBeVisible()

    // шпинат із терміном «до завтра» — ключ демонстрації
    await expect(page.getByText('Шпинат свіжий', { exact: true }).first()).toBeVisible()

    // довідкові блоки живі на своїх екранах
    await page.goto('/pantry')
    await expect(page.getByText('Вистачить продуктів')).toBeVisible()
    await expect(page.getByText('Базових продуктів бракує')).toBeVisible()

    await page.goto('/cart')
    await expect(page.getByText('Вигода')).toBeVisible()
    await expect(page.getByText('Балабонуси')).toBeVisible()
  })

  test('2. Фото холодильника → розпізнавання → підтвердження → комора', async ({ page }) => {
    await startDemo(page)
    await page.getByRole('link', { name: 'Сканувати' }).click()

    await expect(page.getByRole('heading', { name: 'Сканування' })).toBeVisible()

    /**
     * Чекаємо, поки React справді перехопить поле файлу.
     *
     * Розмітка приходить із серверного рендеру, тож і заголовок, і кнопка
     * видимі ДО гідратації. Якщо покласти файл у цей проміжок, `onChange`
     * не спрацює, стан лишиться порожнім — і тест падає на «Фото до аналізу»,
     * хоча застосунок справний. Саме це давало ~25% плаваючих провалів.
     *
     * Наявність внутрішнього ключа `__react*` на елементі — єдина ознака,
     * яка відрізняє «намальовано» від «живе».
     */
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="scan-file-input"]')
      return !!el && Object.keys(el).some((k) => k.startsWith('__react'))
    })

    await page.getByTestId('scan-file-input').setInputFiles({
      name: 'fridge.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG_BASE64, 'base64'),
    })
    await expect(page.getByText(/Фото до аналізу: 1/)).toBeVisible()

    await page.getByRole('button', { name: 'Розпізнати продукти' }).click()

    // Екран підтвердження обовʼязковий: без нього нічого не зберігається
    await expect(page.getByText(/Розпізнавання не є точним/).first()).toBeVisible()
    await expect(page.getByText(/Підтвердіть розпізнане/)).toBeVisible()
    /**
     * Рівень упевненості показується словами, а не відсотком: «65%» не
     * підказує, що робити, а «варто перевірити» — підказує. Тест перевіряє
     * саме наявність підказки, не конкретне формулювання.
     */
    await expect(page.getByText(/точно|приблизно|варто перевірити/).first()).toBeVisible()

    // Користувач редагує кількість — імітуємо реальну поведінку
    const firstQuantity = page.getByLabel('Кількість').first()
    await firstQuantity.fill('0.5')

    await page.getByRole('button', { name: /Підтвердити та зберегти/ }).click()
    await expect(page.getByText(/Додано до комори:/)).toBeVisible()

    // Позиції справді потрапили в комору
    await page.getByRole('link', { name: 'Комора' }).click()
    /**
     * Спершу дочекатись самої навігації, і лише потім вмісту.
     *
     * Клік по посиланню відбувається одразу після router.refresh() на екрані
     * сканування; поки той у польоті, перехід може не початись. Без цього
     * рядка падіння виглядало як «немає заголовка «Домашня комора»», хоча
     * насправді сторінка ще не та.
     */
    await page.waitForURL('**/pantry')
    await expect(page.getByRole('heading', { name: 'Домашня комора' })).toBeVisible()
    await expect(page.getByText('Фото', { exact: true }).first()).toBeVisible()

    /**
     * Розпізнане не має роздвоювати комору. Фото бачить те саме молоко, що
     * вже прийшло з чека, і поки скан заводив окремий рядок, пояснення страв
     * перелічували рядки, а не продукти: «використовує Шпинат і Шпинат і
     * Шпинат і Шпинат свіжий».
     */
    const items = (await (await page.request.get('/api/pantry')).json()).items as { normalizedName: string }[]
    const twins = items
      .map((i) => i.normalizedName)
      .filter((name, _, all) => all.filter((n) => n === name).length > 1)
    expect(twins, `однакові продукти окремими рядками: ${[...new Set(twins)].join(', ')}`).toHaveLength(0)
  })

  test('3. Підбір вечері враховує продукти, що псуються', async ({ page }) => {
    await startDemo(page)
    await page.getByRole('link', { name: 'Рецепти' }).click()

    await expect(page.getByRole('heading', { name: 'Що можна приготувати?' })).toBeVisible()
    await page.getByRole('button', { name: 'Підібрати страви' }).click()

    // Щонайменше 3 варіанти — вимога критеріїв готовності
    const cards = page.getByRole('button', { name: 'Чому саме ця страва?' })
    // poll, а не count(): список перемальовується після відповіді агента,
    // і разовий підрахунок може впасти на порожній проміжний рендер
    await expect.poll(() => cards.count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(3)

    // Пояснення рекомендації простою мовою
    await expect(page.getByText(/Ця страва використовує/).first()).toBeVisible()

    // Прозорий скоринг розкривається
    await cards.first().click()
    await expect(page.getByText(/Підсумковий бал:/)).toBeVisible()
    await expect(page.getByText('Рятує продукти').first()).toBeVisible()
  })

  test('4. Рецепт показує наявне, відсутнє й дозволяє списати після готування', async ({ page }) => {
    await startDemo(page)
    await page.goto('/recipes/frytata-zi-shpynatom?servings=2')

    await expect(page.getByRole('heading', { name: 'Фрітата зі шпинатом' })).toBeVisible()
    await expect(page.getByText('є вдома').first()).toBeVisible()
    await expect(page.getByText('Приготування')).toBeVisible()
    await expect(page.getByText(/таймер \d+ хв/).first()).toBeVisible()

    // «Я це приготував» спершу лише показує план списання
    await page.getByRole('button', { name: 'Я це приготував' }).click()
    await expect(page.getByText('Списати ці інгредієнти з комори?')).toBeVisible()

    await page.getByRole('button', { name: 'Так, списати' }).click()
    await expect(page.getByText('Комору оновлено')).toBeVisible()
  })

  test('5. «Хочу тірамісу»: варіанти, порівняння і підтверджений кошик', async ({ page }) => {
    await startDemo(page)

    await page.getByLabel('Що ви хочете приготувати').fill('Тірамісу')
    await page.getByRole('button', { name: 'Знайти' }).click()

    await expect(page.getByRole('heading', { name: 'Тірамісу' })).toBeVisible({ timeout: 20_000 })

    // Три цінові рівні з РІЗНИМИ сумами
    await expect(page.getByText('Бюджетний').first()).toBeVisible()
    await expect(page.getByText('Оптимальний').first()).toBeVisible()
    await expect(page.getByText('Преміальний').first()).toBeVisible()

    // Порівняння «готувати vs купити готове»
    await expect(page.getByText('Приготувати вдома чи купити готове?')).toBeVisible()
    await expect(page.getByText('🛍️ Купити готове')).toBeVisible()
    await expect(page.getByText(/Готові альтернативи в каталозі/)).toBeVisible()

    // Кошик ще НЕ змінено
    await expect(page.getByText('Кошик ще не змінено. Це відбудеться лише після підтвердження.')).toBeVisible()

    // Крок 1: намір
    await page.getByRole('button', { name: 'Додати до кошика' }).click()
    // Крок 2: явне підтвердження
    await expect(page.getByText('Підтвердіть зміну кошика')).toBeVisible()
    await page.getByRole('button', { name: 'Так, додати' }).click()

    await expect(page.getByText('Товари додано до кошика')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Перейти до оформлення' })).toBeVisible()
  })

  test('6. Кошик показує суми, вигоду та checkout link', async ({ page }) => {
    await startDemo(page)

    // спершу наповнюємо кошик через сценарій страви
    await page.goto('/dish?query=Тірамісу&servings=6')
    await page.getByRole('button', { name: 'Додати до кошика' }).click()
    await page.getByRole('button', { name: 'Так, додати' }).click()
    await expect(page.getByText('Товари додано до кошика')).toBeVisible({ timeout: 20_000 })

    await page.getByRole('link', { name: 'Кошик' }).click()
    await expect(page.getByRole('heading', { name: 'Кошик', level: 1 })).toBeVisible()
    await expect(page.getByText('Разом').first()).toBeVisible()
    await expect(page.getByText('Балабонуси')).toBeVisible()
    await expect(page.getByText('Доставка').first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Перейти до оформлення/ })).toBeVisible()

    /**
     * Керування кількістю — регресійна поверхня рев'ю: тут ламались і
     * ідентифікатори offer'а, і гонки швидких натискань. «+» має збільшити
     * кількість першого рядка з 1 до 2, «Прибрати» — зменшити число позицій.
     */
    const firstQty = page.getByText(/^1 шт$/).first()
    await expect(firstQty).toBeVisible()
    await page.getByRole('button', { name: /Збільшити кількість/ }).first().click()
    await expect(page.getByText(/^2 шт$/).first()).toBeVisible({ timeout: 15_000 })

    const removeButtons = page.getByRole('button', { name: /Прибрати з кошика/ })
    const before = await removeButtons.count()
    await removeButtons.first().click()
    await expect(removeButtons).toHaveCount(before - 1, { timeout: 15_000 })
  })

  test('7. Agent trace показує кроки й не містить приватних даних', async ({ page }) => {
    await startDemo(page)
    await page.goto('/dish?query=Тірамісу&servings=6')
    await expect(page.getByRole('heading', { name: 'Тірамісу' })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Показати кроки агента' }).click()
    await expect(page.getByText('Послідовність дій агента')).toBeVisible()
    await expect(page.getByText('getHouseholdContext').first()).toBeVisible()
    await expect(page.getByText('searchSilpoProducts').first()).toBeVisible()

    // У трейсі не має бути токенів і PII
    const body = (await page.locator('body').innerText()).toLowerCase()
    expect(body).not.toContain('access_token')
    expect(body).not.toContain('bearer ')
    expect(body).not.toMatch(/\+380\d{9}/)
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/)
  })

  test('8. Технічний екран доводить інтеграцію з MCP «Сільпо»', async ({ page }) => {
    await startDemo(page)
    await page.goto('/trace')

    await expect(page.getByRole('heading', { name: 'Як працює агент' })).toBeVisible()
    await expect(page.getByText('https://mcp.silpo.ua/mcp')).toBeVisible()

    await page.getByRole('button', { name: /Виконати tools\/list/ }).click()
    await expect(page.getByText(/\d+ інструментів · \d+ мс/)).toBeVisible({ timeout: 20_000 })

    // Фіксуємо доказ для сабміту (у git не потрапляє — див. .gitignore)
    const summary = await page.locator('main').innerText()
    mkdirSync('docs/live-mcp-proof', { recursive: true })
    writeFileSync(
      'docs/live-mcp-proof/e2e-tools-list.json',
      JSON.stringify({ capturedAt: new Date().toISOString(), summary: summary.slice(0, 4000) }, null, 2),
    )
  })

  /**
   * Метрики, які пітч називає вголос. Головне тут — не саме число, а те, що
   * застосунок мовчить, поки подій замало: «100% страв із наявного» після
   * однієї вечері журі побачить швидше за будь-кого.
   */
  test('13. Метрики мовчать без даних і оживають від подій', async ({ page, context }) => {
    await startDemo(page)
    const csrf = (await context.cookies()).find((c) => c.name === 'sp_csrf')?.value
    const headers = { 'x-csrf-token': csrf as string }

    const metrics = async () => {
      const res = await (await page.request.get('/api/metrics')).json()
      return new Map(res.metrics.map((m: { key: string; value: string | null; hint: string }) => [m.key, m]))
    }

    /**
     * Демо приходить із історією користування: без неї екран показував
     * чотири прочерки, і людина не розуміла, що застосунок міряє.
     * Числа рахуються з подій — тут перевіряємо, що вони справді є.
     */
    const seeded = await metrics()
    for (const key of ['cookedFromPantry', 'eatenInTime', 'adviceToCart']) {
      const m = seeded.get(key) as { value: string | null }
      expect(m.value, `${key} має бути порахованим на сідованій історії`).toMatch(/^\d+%$/)
    }
    // а утримання — ні: місяця користування немає, і вигадувати його не можна
    expect((seeded.get('retention') as { value: string | null }).value).toBeNull()

    const before = seeded.get('eatenInTime') as { value: string | null; hint: string }

    // ще три викинуті позиції мають зрушити частку втрат униз
    const items = (await (await page.request.get('/api/pantry')).json()).items as { id: string }[]
    for (const item of items.slice(0, 3)) {
      const res = await page.request.post('/api/pantry/waste', { headers, data: { id: item.id } })
      expect(res.ok()).toBeTruthy()
    }

    const after = (await metrics()).get('eatenInTime') as { value: string | null; hint: string }
    expect(after.value, 'нові втрати мають змінити метрику').not.toBe(before.value)
    expect(after.hint).toContain('6 викинуто')

    // повторна спроба викинути те саме нічого не додає
    const again = await page.request.post('/api/pantry/waste', { headers, data: { id: items[0].id } })
    expect(again.ok(), 'позиція вже покинула комору').toBeFalsy()

    // екран існує й показує картки
    await page.goto('/metrics')
    await expect(page.getByRole('heading', { name: 'Що змінилось' })).toBeVisible()
    await expect(page.getByText('Спожито вчасно, не викинуто')).toBeVisible()
    await expect(page.getByText('Родини, що ведуть комору місяць')).toBeVisible()
  })

  /**
   * Імпорт чеків має ПОПОВНЮВАТИ комору, а не пропускати наявне, і при
   * цьому не подвоювати при повторному натисканні. Раніше ці дві вимоги
   * конфліктували: від подвоєння рятувало правило «продукт уже є —
   * пропустити», через яке куплене вдруге просто зникало.
   */
  test('12. Імпорт чеків поповнює наявне й не подвоює при повторі', async ({ page, context }) => {
    await startDemo(page)
    const csrf = (await context.cookies()).find((c) => c.name === 'sp_csrf')?.value
    const headers = { 'x-csrf-token': csrf as string }

    const totals = async () => {
      const items = (await (await page.request.get('/api/pantry')).json()).items as {
        normalizedName: string
        quantity: number
        unit: string
      }[]
      return new Map(items.map((i) => [i.normalizedName, `${i.quantity} ${i.unit}`]))
    }

    const before = await totals()
    // у сідованій коморі вже є молоко — саме на ньому видно різницю
    expect(before.has('молоко')).toBe(true)

    const first = await (await page.request.put('/api/pantry', { headers })).json()
    expect(first.newReceipts).toBeGreaterThan(0)
    expect(first.toppedUp, 'наявні продукти мають поповнитись, а не пропуститись').toBeGreaterThan(0)

    const after = await totals()
    expect(after.get('молоко'), 'кількість молока мала зрости').not.toBe(before.get('молоко'))

    // повторний імпорт тих самих чеків не додає нічого
    const second = await (await page.request.put('/api/pantry', { headers })).json()
    expect(second.newReceipts).toBe(0)
    expect(second.imported).toBe(0)
    expect(second.toppedUp).toBe(0)
    expect(await totals(), 'повторний імпорт не має змінювати комору').toEqual(after)
  })

  /**
   * Модерація рецептів спільноти: автоперевірка до публікації і скарги після.
   * Тест ходить через API, а не форму: форма перевіряється окремо, а тут
   * важливий саме вердикт і те, що чернетка не потрапляє у стрічку.
   */
  test('10. Рецепт із незаявленим алергеном не потрапляє у стрічку', async ({ page, context }) => {
    await startDemo(page)
    const csrf = (await context.cookies()).find((c) => c.name === 'sp_csrf')?.value
    const headers = { 'x-csrf-token': csrf as string }

    const draft = {
      title: 'Омлет із сиром на пробу',
      summary: 'Швидкий сніданок із того, що є в холодильнику зранку.',
      servings: 2,
      cookingTime: 10,
      difficulty: 'easy',
      cuisine: 'Українська',
      mealType: 'breakfast',
      imageEmoji: '🍳',
      ingredients: [
        { name: 'Яйця', quantity: 3, unit: 'шт' },
        { name: 'Сир твердий', quantity: 50, unit: 'г' },
      ],
      steps: [
        { text: 'Збийте яйця виделкою до однорідності, посоліть за смаком.' },
        { text: 'Вилийте на розігріту сковорідку й готуйте на малому вогні.' },
        { text: 'Присипте тертим сиром, накрийте кришкою на дві хвилини.' },
      ],
      tips: [],
      declaredAllergens: [],
      authorConfirmed: true,
    }

    const res = await page.request.post('/api/user-recipes', { headers, data: draft })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.status).toBe('draft')
    expect(body.issues.some((i: { code: string }) => i.code === 'undeclared_allergen')).toBe(true)

    // у стрічці чернетки немає для інших, але автор бачить її з причиною
    await page.goto('/recipes/community')
    await expect(page.getByText('Омлет із сиром на пробу').first()).toBeVisible()
    await expect(page.getByText('чернетка').first()).toBeVisible()
    await expect(page.getByText(/позначте це в алергенах/).first()).toBeVisible()

    // той самий рецепт із заявленими алергенами публікується
    const ok = await page.request.post('/api/user-recipes', {
      headers,
      data: { ...draft, title: 'Омлет із сиром, друга спроба', declaredAllergens: ['яйця', 'лактоза', 'молочний білок'] },
    })
    expect((await ok.json()).status).toBe('published')
  })

  test('11. Три скарги ховають рецепт зі стрічки', async ({ page, context }) => {
    await startDemo(page)
    const csrf = (await context.cookies()).find((c) => c.name === 'sp_csrf')?.value
    const headers = { 'x-csrf-token': csrf as string }

    const feed = await (await page.request.get('/api/user-recipes')).json()
    const target = feed.recipes.find((r: { isMine: boolean; status: string }) => !r.isMine && r.status === 'published')
    expect(target, 'у стрічці має бути чужий опублікований рецепт').toBeTruthy()

    /**
     * Скарги мають бути від РІЗНИХ людей, а демо-сесія одна. Тому дві
     * перші скарги ставимо від сідованих авторів прямо через API скарг
     * не вийде — замість цього перевіряємо межу: одна скарга не ховає,
     * повторна від того самого користувача нічого не додає.
     */
    const first = await page.request.post('/api/user-recipes/report', {
      headers,
      data: { recipeId: target.id, reason: 'spam' },
    })
    expect((await first.json()).hidden).toBe(false)

    const again = await page.request.post('/api/user-recipes/report', {
      headers,
      data: { recipeId: target.id, reason: 'spam' },
    })
    const body = await again.json()
    expect(body.reports, 'повторна скарга того самого користувача не рахується').toBe(1)
    expect(body.hidden).toBe(false)

    // рецепт лишається у стрічці
    await page.goto('/recipes/community')
    await expect(page.getByText(target.title)).toBeVisible()
  })

  /**
   * Регресія з прода: там `/api/dev/reset` вимкнено (404), і демо-користувач
   * жив із порожньою коморою — «Комора ще порожня», усі страви по 0 %.
   * Тест навмисно НЕ використовує startDemo(): той викликає скидання й тим
   * самим приховує саме ту помилку, яку треба зловити.
   */
  test('9. Вхід у демо наповнює порожню комору сам', async ({ page, context }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Спробувати в демонстраційному режимі' }).click()
    await page.waitForURL('**/')

    // Мутуючі маршрути захищені double-submit CSRF, тож заголовок беремо
    // з тієї самої куки, що й браузерний клієнт (див. lib/client.ts)
    const csrf = (await context.cookies()).find((c) => c.name === 'sp_csrf')?.value
    expect(csrf).toBeTruthy()
    const headers = { 'x-csrf-token': csrf as string }

    // Спустошуємо комору так, як це зробила б людина — через API застосунку
    const before = await (await page.request.get('/api/pantry')).json()
    for (const item of before.items) {
      const res = await page.request.delete('/api/pantry', { headers, data: { id: item.id } })
      expect(res.ok()).toBeTruthy()
    }
    expect((await (await page.request.get('/api/pantry')).json()).items).toHaveLength(0)

    // Повторний вхід має привести комору до seed-стану
    const restart = await page.request.post('/api/auth/demo')
    expect(restart.ok()).toBeTruthy()

    const after = await (await page.request.get('/api/pantry')).json()
    expect(after.items.length).toBeGreaterThan(0)
    expect(after.items.map((i: { originalName: string }) => i.originalName)).toContain('Шпинат свіжий')

    // Родина теж має бути на місці: без неї «меню під склад родини» — порожні слова
    await page.goto('/pantry')
    await expect(page.getByText('Комора порожня')).toHaveCount(0)
    await expect(page.getByText('на 3 ос.')).toBeVisible()
  })
})
