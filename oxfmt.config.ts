import { defineConfig } from 'oxfmt'
import { oxfmtConfig } from '@viclafouch/oxc-config/formatting'

export default defineConfig({
  ...oxfmtConfig,
  ignorePatterns: [
    '**/*.md',
    '**/routeTree.gen.ts',
    '**/cn-tables.ts',
    '**/dist/**',
    '**/.tanstack/**'
  ]
})
