import { defineConfig } from 'vitest/config'

const TEST_TIMEOUT_MS = 30_000

const POLL_TIMEOUT_UNDER_THE_TEST_TIMEOUT_MS = 25_000

export default defineConfig({
  test: {
    name: 'default',
    include: ['src/**/*.test.ts'],
    testTimeout: TEST_TIMEOUT_MS,
    env: { LOG_LEVEL: 'info' },
    isolate: false,
    silent: 'passed-only',
    expect: {
      requireAssertions: true,
      poll: { timeout: POLL_TIMEOUT_UNDER_THE_TEST_TIMEOUT_MS }
    },
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    sequence: { shuffle: { files: true, tests: true } },
    setupFiles: ['@workcell/core/fail-on-console']
  }
})
