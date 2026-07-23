const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettierPlugin = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'outputs/**',
      'coverage/**',
      'tools/**',
      'scripts/**',
      'eslint.config.js',
      'jest.config.js',
      'plugins/**/*.js',
    ],
  },
  ...tseslint.configs['flat/recommended'],
  {
    files: ['src/**/*.ts', 'plugins/example/**/*.ts', 'test/**/*.ts', 'plugin-api.d.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [
          './tsconfig.json',
          './tsconfig.test.json',
          './plugins/tsconfig.json',
        ],
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      'prettier/prettier': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  prettierConfig,
];
