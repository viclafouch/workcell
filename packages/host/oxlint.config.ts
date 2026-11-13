import { defineConfig } from 'oxlint'
import { imports, turbo, typescript, vitest } from '@viclafouch/oxc-config'

const ROOT_LOGGER_PATH = {
  name: 'pino',
  message:
    'Take the logger as a parameter, typed by the methods that the module calls. The distribution passes a child of the root logger that createLogger() of src/logger.ts makes.'
}

const MODEL_PROVIDER_MESSAGE =
  'Take a text adapter from createModels() of src/models/models.ts.'

const MODEL_PROVIDER_PATHS = [
  '@tanstack/ai-anthropic',
  '@tanstack/ai-openai'
].map((name) => {
  return { name, message: MODEL_PROVIDER_MESSAGE }
})

const MODEL_PROVIDER_PATTERN = {
  group: ['@tanstack/ai-anthropic/*', '@tanstack/ai-openai/*'],
  message: MODEL_PROVIDER_MESSAGE
}

const RESTRICTED_IMPORT_PATHS = [ROOT_LOGGER_PATH, ...MODEL_PROVIDER_PATHS]

type RestrictedImportsRule = [
  'error',
  {
    paths: typeof RESTRICTED_IMPORT_PATHS
    patterns: (typeof MODEL_PROVIDER_PATTERN)[]
  }
]

function restrictImportsExcept(
  ...allowed: readonly object[]
): RestrictedImportsRule {
  return [
    'error',
    {
      paths: RESTRICTED_IMPORT_PATHS.filter((path) => {
        return !allowed.includes(path)
      }),
      patterns: allowed.includes(MODEL_PROVIDER_PATTERN)
        ? []
        : [MODEL_PROVIDER_PATTERN]
    }
  ]
}

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
    'import/extensions': [
      'error',
      'always',
      { ignorePackages: true, checkTypeImports: true }
    ],
    'no-restricted-imports': restrictImportsExcept(),
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
      files: ['src/logger.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(ROOT_LOGGER_PATH)
      }
    },
    {
      files: ['src/models/models.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(
          ...MODEL_PROVIDER_PATHS,
          MODEL_PROVIDER_PATTERN
        )
      }
    }
  ]
})
