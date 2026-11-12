import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'default',
    include: ['src/**/*.test.ts'],
    env: { LOG_LEVEL: 'info' },
    isolate: false,
    silent: 'passed-only',
    expect: { requireAssertions: true },
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    sequence: { shuffle: { files: true, tests: true } },
    setupFiles: ['@workcell/core/fail-on-console']
  }
})
