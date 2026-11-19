import { createReactConfig } from '@karen/eslint-config/react';

export default [
  ...createReactConfig({
    tsconfigRootDir: import.meta.dirname,
    ignores: ['.expo/**', 'expo-env.d.ts', '.expo-export-check/**'],
  }),
  {
    files: ['*.config.js', 'metro.config.js', 'jest.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
  },
];
