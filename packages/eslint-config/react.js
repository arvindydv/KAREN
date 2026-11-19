import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { createBaseConfig } from './base.js';

export function createReactConfig(options = {}) {
  return [
    ...createBaseConfig(options),
    {
      plugins: { 'react-hooks': reactHooks },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
      languageOptions: { globals: { ...globals.browser } },
    },
  ];
}
