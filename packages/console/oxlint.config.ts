import { defineConfig } from 'oxlint'
import {
  hooks,
  imports,
  jsxA11y,
  playwright,
  react,
  tanstackQuery,
  tanstackStart,
  turbo,
  typescript,
  vitest
} from '@viclafouch/oxc-config'

const FILES_RUN_BY_NODE = ['*.ts', 'e2e/**', 'scripts/**']

export default defineConfig({
  extends: [
    typescript,
    react,
    hooks,
    jsxA11y,
    tanstackQuery,
    tanstackStart,
    turbo,
    vitest,
    playwright,
    imports
  ],
  jsPlugins: ['./scripts/oxlint/plugin.ts'],
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: 'error',
    maxWarnings: 0
  },
  ignorePatterns: [
    'node_modules/**',
    'dist/**',
    '.tanstack/**',
    'src/routeTree.gen.ts',
    'src/lib/cn-tables.ts',
    'src/components/ui/**',
    'src/hooks/use-mobile.ts',
    '.claude/**'
  ],
  rules: {
    'import/extensions': [
      'error',
      'always',
      { ignorePackages: true, checkTypeImports: true }
    ],
    'workcell-console/no-link-as-button': 'error',
    'workcell-console/no-manual-memo': 'error',
    'jsx-a11y/no-noninteractive-tabindex': ['error', { tags: ['hr'] }],
    'react/forbid-elements': [
      'error',
      {
        forbid: [
          { element: 'input', message: 'Use the shadcn `Input`.' },
          { element: 'textarea', message: 'Use the shadcn `Textarea`.' },
          {
            element: 'select',
            message: 'Use the shadcn `NativeSelect` or `Select`.'
          },
          { element: 'button', message: 'Use the shadcn `Button`.' },
          { element: 'table', message: 'Use the shadcn `Table`.' }
        ]
      }
    ]
  },
  overrides: [
    {
      files: FILES_RUN_BY_NODE,
      rules: {
        'import/no-relative-parent-imports': 'off'
      }
    },
    {
      files: ['playwright.config.ts'],
      rules: {
        'node/no-process-env': 'off',
        'turbo/no-undeclared-env-vars': ['error', { allowList: ['^CI$'] }]
      }
    },
    {
      files: ['scripts/oxlint/__tests__/**'],
      plugins: ['vitest'],
      rules: {
        'vitest/require-hook': [
          'error',
          { allowedFunctionCalls: ['ruleTester.run'] }
        ]
      }
    },
    {
      files: ['scripts/oxlint/plugin.ts'],
      rules: {
        'import/no-default-export': 'off'
      }
    }
  ]
})
