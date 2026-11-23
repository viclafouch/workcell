import { defineConfig } from 'vitest/config'

const TEST_TIMEOUT_FOR_REAL_GIT_AND_POSTGRES_WORK_MS = 15_000

const POLL_SHARE_OF_THE_TEST_TIMEOUT = 0.8

const POLL_TIMEOUT_UNDER_THE_TEST_TIMEOUT_MS =
  TEST_TIMEOUT_FOR_REAL_GIT_AND_POSTGRES_WORK_MS *
  POLL_SHARE_OF_THE_TEST_TIMEOUT

export default defineConfig({
  test: {
    name: 'default',
    include: ['src/**/*.test.ts'],
    testTimeout: TEST_TIMEOUT_FOR_REAL_GIT_AND_POSTGRES_WORK_MS,
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
    globalSetup: ['src/testing/postgres-global-setup.ts'],
    setupFiles: ['src/testing/fail-on-console.ts']
  }
})
