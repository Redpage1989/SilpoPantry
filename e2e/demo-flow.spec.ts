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
})
