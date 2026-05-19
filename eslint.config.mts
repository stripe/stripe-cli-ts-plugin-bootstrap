import * as eslint from '@eslint/js'
import { defineConfig } from 'eslint/config'
import tseslint from 'typescript-eslint'

// TODO: Re-enable recommendedTypeChecked once existing code is cleaned up.
// Currently using 'recommended' (non-type-checked) to unblock CI setup.
// The goal is to fix existing any types and unsafe patterns, then switch back to:
//   tseslint.configs.recommendedTypeChecked
export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'test/*.ts',
            '*.mts',
            '*.ts',
            'scripts/*.ts',
            'scripts/*.cjs',
            'scripts/*.mjs',
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: __dirname,
      },
    },
  },
  {
    ignores: ['**/dist/**/*', '**/esbuild.config.js', 'templates/**/*'],
  },
  {
    files: ['./*.cjs', 'scripts/*.cjs'],
    languageOptions: {
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['scripts/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['**/src/**/*.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // TODO: Remove this once existing code is cleaned up
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
