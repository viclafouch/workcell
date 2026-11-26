import { defineConfig } from 'knip/config'

export default defineConfig({
  treatConfigHintsAsErrors: true,
  workspaces: {
    'packages/dashboard': {
      entry: [
        'src/components/ui/**/*.tsx',
        'src/hooks/use-highlighted-code.ts',
        'src/hooks/use-mobile.ts',
        'src/server/development-context.dev.ts'
      ],
      ignoreIssues: {
        'src/components/ui/**': ['exports', 'types']
      }
    }
  }
})
