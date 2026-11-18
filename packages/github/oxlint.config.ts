import { defineConfig } from 'oxlint'
import { imports, turbo, typescript, vitest } from '@viclafouch/oxc-config'

const SHARED_MODULE_GRAPH_MESSAGE =
  'The tests share one module graph (isolate: false). A module mock leaks across files. Pass the dependency in, or put a local server in front of the network.'

const [UNUSED_VARS_LEVEL, UNUSED_VARS_OPTIONS] =
  typescript.rules['no-unused-vars']

export default defineConfig({
  extends: [typescript, turbo, vitest, imports],
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: 'error',
    maxWarnings: 0
  },
  ignorePatterns: ['node_modules/**'],
  rules: {
    'no-unused-vars': [
      UNUSED_VARS_LEVEL,
      { ...UNUSED_VARS_OPTIONS, ignoreUsingDeclarations: true }
    ],
    'no-restricted-globals': [
      'error',
      {
        name: 'fetch',
        message:
          'Call GitHub through GithubOctokit: it carries the auth, the retries and the rate limits.'
      }
    ],
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
  },
  overrides: [
    {
      files: ['src/**/*.test.ts'],
      plugins: ['vitest'],
      rules: {
        'vitest/require-hook': [
          'error',
          { allowedFunctionCalls: ['serveGithubPerTest'] }
        ]
      }
    }
  ]
})
