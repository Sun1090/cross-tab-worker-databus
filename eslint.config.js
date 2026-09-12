import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'examples/**', '**/*.config.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // scripts/ is Node ESM tooling that CI and the release workflow actually
    // run, so it is linted too — with Node globals and console output allowed
    // (a CLI's job is to print).
    files: ['scripts/**/*.{mjs,mts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Hand-written declarations for the untyped demo-server JS modules. An
    // event-listener `(...args: any[]) => void` matches Node's own typings for
    // EventEmitter#on, so `any` is the correct shape here.
    files: ['scripts/**/*.d.mts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // bench-browser.mjs drives a real Chromium page: the `waitForFunction`
    // callback below is serialized and evaluated *in the browser*, so
    // `document` is a legitimate global in this otherwise-Node file.
    files: ['scripts/bench-browser.mjs'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
