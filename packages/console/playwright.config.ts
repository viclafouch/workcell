import { defineConfig, devices } from '@playwright/test'

const E2E_PORT = 7419

const E2E_URL = `http://localhost:${E2E_PORT}`

const IS_CI = Boolean(process.env.CI)

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  timeout: 30_000,
  forbidOnly: IS_CI,
  reporter: IS_CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: E2E_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce'
  },
  webServer: {
    command: `pnpm exec vite dev --port ${E2E_PORT}`,
    url: E2E_URL,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/u,
      testIgnore: /.*\.mobile\.spec\.ts/u,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-safari',
      testMatch: /.*\.mobile\.spec\.ts/u,
      use: { ...devices['iPhone 15'] }
    }
  ]
})
