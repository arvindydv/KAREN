import nextVitals from 'eslint-config-next/core-web-vitals';
import { createReactConfig } from '@karen/eslint-config/react';

// Next's rules first, then the shared KAREN config (which owns parser/type-aware settings).
const config = [
  ...nextVitals,
  ...createReactConfig({
    tsconfigRootDir: import.meta.dirname,
    ignores: ['next-env.d.ts', 'playwright-report/**', 'test-results/**'],
  }),
];

export default config;
