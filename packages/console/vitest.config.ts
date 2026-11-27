import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'default',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    isolate: false,
    silent: 'passed-only',
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    sequence: { shuffle: { files: true, tests: true } }
  }
})
