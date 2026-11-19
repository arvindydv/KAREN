import { createNodeConfig } from '@karen/eslint-config/node';

export default [
  ...createNodeConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // Workflow code must be deterministic: no Node APIs, timers, randomness or I/O.
    files: ['src/workflows/**/*.ts'],
    ignores: ['src/workflows/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'crypto', 'http', 'https', 'net'],
              message: 'Workflows must be deterministic: no Node APIs.',
            },
            {
              group: [
                '@karen/domain/node',
                '@karen/observability*',
                '@temporalio/activity',
                '@temporalio/client',
                '@temporalio/worker',
              ],
              message: 'Not allowed in workflow code.',
            },
            {
              group: ['../activities/*'],
              message: 'Workflows call activities via proxyActivities with type-only imports.',
              allowTypeImports: true,
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'setTimeout', 'setInterval', 'fetch'],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use workflow-safe uuid4() from @temporalio/workflow.',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            'Use workflow time via Date.now() is replaced by Temporal; prefer explicit inputs.',
        },
      ],
    },
  },
];
