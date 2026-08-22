import { defineConfig, devices } from '@playwright/test'

/**
 * E2E проганяє повний demo-сценарій на реальному мобільному вʼюпорті 390×844 —
 * тому самому мінімумі, який задано в ТЗ.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  /**
   * Ліміти розраховані на ПРОДАКШН-збірку (див. webServer нижче).
   *
   * Спершу я підняв їх до 180/30 с, щоб пережити завантажену машину. Це не
   * спрацювало: прогін розтягнувся на 37 хвилин, а провали лишились. Причина
   * була не в лімітах, а в тому, що тести ганяли dev-сервер, який компілює
   * маршрути на льоту й конкурує за CPU з усім, що працює поруч.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  /**
   * Один повтор і локально. Це НЕ спосіб приховати нестабільність: у звіті
   * видно `flaky`, і кожен такий випадок варто розібрати. Але падіння через
   * те, що поруч збирався Flutter, не має блокувати роботу.
   */
  retries: 1,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3210',
    viewport: { width: 390, height: 844 },
    locale: 'uk-UA',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Chromium, а не WebKit: мобільний вʼюпорт нам потрібен, а другий рушій
  // у прототипі лише подвоює час встановлення без нової інформації.
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false, hasTouch: true },
    },
  ],
  /**
   * Прод-збірка, а не dev.
   *
   * `next dev` компілює кожен маршрут при першому зверненні: на вільній
   * машині це 2 с, при load average 250 — до 60 с, і саме звідси бралися
   * «плаваючі» провали. `next build` платить один раз наперед, далі сервер
   * лише віддає готове.
   *
   * `reuseExistingServer` лишається: якщо ви вже підняли `npm run dev`,
   * тести підуть у нього — це зручно, коли правиш тест і ганяєш його
   * по колу. Для чесного прогону сервер треба зупинити.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run start',
        port: 3210,
        reuseExistingServer: true,
        timeout: 600_000,
        /**
         * `next start` виставляє NODE_ENV=production, тож маршрут скидання
         * демо-стану вимикається. Ця змінна вмикає його назад — і лише для
         * демо-користувача (див. src/app/api/dev/reset/route.ts).
         * На сервері вона не задана й задаватись не має.
         */
        env: { E2E_TEST_RESET: 'true' },
      },
})
