import { defineConfig } from 'oxlint'
import { imports, typescript } from '@viclafouch/oxc-config'

export default defineConfig({
  extends: [typescript, imports],
  ignorePatterns: ['node_modules/**'],
  rules: {
    'import/extensions': [
      'error',
      'always',
      { ignorePackages: true, checkTypeImports: true }
    ]
  }
})
