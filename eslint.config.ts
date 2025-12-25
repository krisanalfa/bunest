import { defineConfig } from 'eslint/config'
import globals from 'globals'
import js from '@eslint/js'
import sonarjs from 'eslint-plugin-sonarjs'
import stylistic from '@stylistic/eslint-plugin'
import tseslint from 'typescript-eslint'

export default defineConfig([
  {
    files: ['**/*.ts'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: { globals: globals.node },
  },
  stylistic.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  sonarjs.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'sort-imports': ['error', {
        ignoreCase: false,
        ignoreDeclarationSort: false,
        ignoreMemberSort: false,
        memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
        allowSeparatedGroups: true,
      }],
      'sonarjs/no-empty-test-file': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
])
