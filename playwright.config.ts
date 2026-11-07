// Robot tests (end-to-end) for the real app on the local Firebase emulator. Run them with `npm run e2e`
// (scripts/e2e.mjs starts the emulators + the app and sets E2E_BASE_URL). See tests/e2e/README.md.
import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'

// This machine has Chromium pre-installed here; CI installs Playwright's own (npx playwright install chromium).
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium'
const launchOptions = existsSync(LOCAL_CHROMIUM) ? { executablePath: LOCAL_CHROMIUM } : {}

// A phone: the app is phone-first (iPhone-sized screen, touch). Laptop journeys switch to 1440×900 themselves.
const phone = {
  ...devices['Desktop Chrome'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
}

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  outputDir: '.e2e/results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    // Fewer moving parts: no splash fade, no slide-up animations, no service worker caching old files.
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    timezoneId: 'America/Toronto',
    locale: 'en-CA',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions,
    ...phone,
  },
  projects: [
    // Journeys share one emulator and each file starts from fresh test data, so they run one file at a time.
    { name: 'journeys', testDir: 'tests/e2e/journeys', workers: 1 },
    // The crawl only looks around (every route, every role), so roles run side by side.
    { name: 'crawl', testDir: 'tests/e2e/crawl' },
  ],
})
