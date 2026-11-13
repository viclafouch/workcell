import { defineConfig, type OxlintConfig } from 'oxlint'
import { imports, turbo, typescript } from '@viclafouch/oxc-config'

const FULL_FILE_NAME_FOR_NODE_TYPE_STRIPPING = [
  'error',
  'always',
  { ignorePackages: true, checkTypeImports: true }
] satisfies NonNullable<OxlintConfig['rules']>['import/extensions']

export default defineConfig({
  extends: [typescript, turbo, imports],
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: 'error',
    maxWarnings: 0
  },
  ignorePatterns: ['node_modules/**'],
  rules: {
    'import/extensions': FULL_FILE_NAME_FOR_NODE_TYPE_STRIPPING
  }
})
