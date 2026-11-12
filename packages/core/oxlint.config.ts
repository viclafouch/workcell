import { defineConfig, type OxlintConfig, type OxlintOverride } from 'oxlint'
import { imports, typescript, vitest } from '@viclafouch/oxc-config'

const ROOT_LOGGER_PATH = {
  name: 'pino',
  message:
    'Take the logger as a parameter, typed by the methods that the module calls. The distribution passes a child of its root logger.'
}

const MODEL_PROVIDER_MESSAGE =
  'Take a text adapter as an option of openWorkcell(). The distribution picks the model.'

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

const LOCAL_SANDBOX_PATH = {
  name: '@tanstack/ai-sandbox-local-process',
  message:
    'Take a sandbox from createHostFreeProvider() or createHostFreeSandbox() of src/sandbox/host-free-sandbox.ts. Its HOME holds no login of the host, so a command that a rule lets through never reaches GitHub.'
}

const DATABASE_DRIVER_PATH = {
  name: 'pg',
  message:
    'Take the database from openDatabase() of src/store/database.ts. It retries the connection after a cold start of a serverless Postgres, and logs a failed query with no parameter.'
}

const MIGRATION_TOOL_PATH = {
  name: 'node-pg-migrate',
  message:
    'Take migrateDatabase() of src/store/migrate-database.ts. It applies the migrations on the direct URL, in one transaction.'
}

const SHARED_RETRYER_PATH = {
  name: '@tanstack/pacer',
  importNames: ['asyncRetry'],
  message:
    'asyncRetry shares one retryer, and a second call aborts the first one. Make one AsyncRetryer per call.'
}

const SHARED_RESULT_LIMITER_PATH = {
  name: '@tanstack/pacer',
  importNames: ['AsyncRateLimiter', 'asyncRateLimit'],
  message:
    'AsyncRateLimiter returns the last result of any call, and its retries pass the budget. Gate each HTTP call with a RateLimiter, and make one AsyncRetryer per call. It counts each retry in the budget, and gives each call its own answer.'
}

const MEMORY_PERSISTENCE_PATH = {
  name: '@tanstack/ai-persistence',
  importNames: ['memoryPersistence', 'memoryLogStore'],
  message:
    'A memory store loses every thread on a restart. Take createHarnessPersistence() of src/store/harness-persistence.ts. A test can use memoryPersistence().'
}

const HARNESS_HOST_PATH = {
  name: '@tanstack/ai-harness',
  importNames: ['createHarnessHost'],
  message:
    'Take createAgentHost() of src/host/agent-host.ts. It sets the log retention of every host.'
}

const POSTGRES_CONTAINER_PATH = {
  name: '@testcontainers/postgresql',
  message:
    'Take a database from createMigratedDatabase() or createDatabase() of src/store/test-database.ts. The global setup starts one Postgres container for the whole test run.'
}

const RESTRICTED_IMPORT_PATHS = [
  ROOT_LOGGER_PATH,
  ...MODEL_PROVIDER_PATHS,
  LOCAL_SANDBOX_PATH,
  DATABASE_DRIVER_PATH,
  MIGRATION_TOOL_PATH,
  SHARED_RETRYER_PATH,
  SHARED_RESULT_LIMITER_PATH,
  MEMORY_PERSISTENCE_PATH,
  HARNESS_HOST_PATH,
  POSTGRES_CONTAINER_PATH
]

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
      patterns: [MODEL_PROVIDER_PATTERN]
    }
  ]
}

const FULL_FILE_NAME_FOR_NODE_TYPE_STRIPPING = [
  'error',
  'always',
  { ignorePackages: true, checkTypeImports: true }
] satisfies NonNullable<OxlintConfig['rules']>['import/extensions']

const FOUR_ARGUMENT_SET_IF_OF_TANSTACK_METADATA_STORE = {
  files: ['src/store/metadata-store.ts'],
  rules: {
    'max-params': 'off'
  }
} satisfies OxlintOverride

const VITEST_PROVIDED_CONTEXT_MERGES_ONLY_AS_AN_INTERFACE = {
  files: ['src/store/test-database.ts'],
  rules: {
    '@typescript-eslint/consistent-type-definitions': 'off'
  }
} satisfies OxlintOverride

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
    'import/extensions': FULL_FILE_NAME_FOR_NODE_TYPE_STRIPPING,
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
    FOUR_ARGUMENT_SET_IF_OF_TANSTACK_METADATA_STORE,
    VITEST_PROVIDED_CONTEXT_MERGES_ONLY_AS_AN_INTERFACE,
    {
      files: ['src/fail-on-console.ts'],
      plugins: ['vitest'],
      rules: {
        'vitest/require-top-level-describe': 'off',
        'vitest/require-hook': 'off'
      }
    },
    {
      files: ['src/**/*.test.ts'],
      plugins: ['vitest'],
      rules: {
        'vitest/require-hook': [
          'error',
          {
            allowedFunctionCalls: [
              'runPersistenceConformance',
              'runSandboxInstanceStoreConformance'
            ]
          }
        ],
        'no-restricted-imports': restrictImportsExcept(
          MEMORY_PERSISTENCE_PATH,
          HARNESS_HOST_PATH
        )
      }
    },
    {
      files: ['src/host/agent-host.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(HARNESS_HOST_PATH)
      }
    },
    {
      files: ['src/sandbox/host-free-sandbox.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(LOCAL_SANDBOX_PATH)
      }
    },
    {
      files: ['src/workers/tool-call.ts', 'src/sandbox/library-question.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(MEMORY_PERSISTENCE_PATH)
      }
    },
    {
      files: ['src/store/database.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(DATABASE_DRIVER_PATH)
      }
    },
    {
      files: ['src/store/postgres-global-setup.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(POSTGRES_CONTAINER_PATH)
      }
    },
    {
      files: ['src/store/migrate-database.ts'],
      rules: {
        'no-restricted-imports': restrictImportsExcept(MIGRATION_TOOL_PATH)
      }
    }
  ]
})
