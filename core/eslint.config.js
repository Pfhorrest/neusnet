// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Protocol code intentionally uses explicit return types on all
      // exported functions for clarity in a reference implementation;
      // this rule just makes that a hard requirement rather than a habit.
      '@typescript-eslint/explicit-function-return-type': 'error',

      // `noUncheckedIndexedAccess` (tsconfig.json) makes every array/record
      // index access `T | undefined`, including in low-level binary code
      // (base64/base58 encoding, tag-component arrays) where the index is
      // guaranteed in-range by surrounding bitwise/length arithmetic the
      // type checker can't itself verify. Banning `!` entirely there would
      // force either misleading `as T` casts or defensive runtime checks
      // for conditions that cannot actually occur; a `!` with a short
      // comment at the point of use is clearer. Reviewed case by case
      // instead of blanket-disallowed.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Numbers interpolate predictably in template literals (unlike
      // objects, which is what this rule is really guarding against);
      // disallowing them produces noisy, low-value errors on ordinary
      // error-message construction throughout this codebase.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // Leading-underscore is this codebase's convention for a
      // destructured binding kept only to exclude it from a `...rest`
      // spread (e.g. `const { signature: _signature, ...rest } = obj`).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Flat-config and tool-config files aren't part of the src/test
    // TypeScript project (tsconfig.json's "include"), so type-aware
    // linting can't resolve a project for them; type-aware rules add
    // little value for these files anyway.
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.js', 'vitest.config.ts'],
  },
);
