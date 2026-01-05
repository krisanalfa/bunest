import { defineConfig } from 'eslint/config'
import projectConfig from '../../eslint.config.js'

export default defineConfig([
  ...projectConfig,
  {
    ignores: ['lib/test/**/assets/**'],
  },
])
