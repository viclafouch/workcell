import { defineConfig } from 'vitest/config'

const POLL_TIMEOUT_UNDER_THE_TEST_TIMEOUT_MS = 4_000

export default defineConfig({
  test: {
    name: 'default',
    include: ['src/**/*.test.ts'],
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
