import { defineConfig } from 'oxlint'
import { imports, typescript, vitest } from '@viclafouch/oxc-config'

const SHARED_MODULE_GRAPH_MESSAGE =
  'The tests share one module graph (isolate: false). A module mock leaks across files. Pass the dependency in, or put a local server in front of the network.'

export default defineConfig({
  extends: [typescript, imports, vitest],
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: 'error',
    maxWarnings: 0
  },
  ignorePatterns: ['node_modules/**'],
  rules: {
    'import/extensions': [
      'error',
      'always',
      { ignorePackages: true, checkTypeImports: true }
    ],
    'vitest/no-restricted-vi-methods': [
      'error',
      {
        mock: SHARED_MODULE_GRAPH_MESSAGE,
        doMock: SHARED_MODULE_GRAPH_MESSAGE
      }
    ]
  }
})
