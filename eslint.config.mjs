// @ts-check
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/**', '**/node_modules/**', '**/*.d.ts']),

  eslint.configs.recommended,

  {
    // Type-aware rules only where there is a TS program to be aware of. This config file is not
    // part of any package tsconfig, and linting it with type information yields false positives.
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root tooling configs belong to no package project; type-check them against
          // tsconfig.tools.json rather than dropping type-aware rules for them.
          allowDefaultProject: ['vitest.config.ts'],
          defaultProject: 'tsconfig.tools.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Size limits from coding-dev.md §4, enforced by the linter rather than by eye.
      'max-lines': ['error', { max: 1000, skipBlankLines: false, skipComments: false }],
      'max-lines-per-function': ['error', { max: 100, skipBlankLines: false, skipComments: false }],
      'max-params': ['error', 4],
      'max-depth': ['error', 3],

      // Banned constructs from js-typescript.md §3.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use an `as const` object plus a literal union instead of `enum`.',
        },
        {
          selector: 'TSModuleDeclaration[kind="namespace"]',
          message: 'Use ES modules instead of `namespace`.',
        },
      ],

      // The host injects into a third-party page; a floating promise there is a silent failure.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  {
    files: ['**/*.test.ts'],
    rules: {
      // Table-driven test bodies are clearer whole than split.
      'max-lines-per-function': 'off',
      // `node:test`'s `test()` returns a promise the runner owns; awaiting it at top level is wrong.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
]);
