import { createNodeConfig } from '@karen/eslint-config/node';

export default [
  ...createNodeConfig({ tsconfigRootDir: import.meta.dirname, ignores: ['src/generated/**'] }),
];
