import { defineConfig, devices } from '@playwright/test'

/**
 * E2E проганяє повний demo-сценарій на реальному мобільному вʼюпорті 390×844 —
 * тому самому мінімумі, який задано в ТЗ.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
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
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        port: 3210,
        reuseExistingServer: true,
        timeout: 120_000,
      },
})
