// Shared ESLint flat config for all KAREN TypeScript workspaces.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Architectural boundary rules shared by every workspace:
 *  - no deep imports into another workspace's private source (`@karen/x/src/...`)
 *  - no relative imports that escape the current workspace into a sibling app/package
 */
const boundaryRules = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@karen/*/src/*', '@karen/*/dist/*'],
          message: 'Import from the package public entrypoint, not its private files.',
        },
        {
          group: ['../../apps/*', '../../../apps/*', '../../packages/*', '../../../packages/*'],
          message: 'Cross-workspace relative imports are forbidden; depend on the package instead.',
        },
      ],
    },
  ],
};

export function createBaseConfig({ tsconfigRootDir, ignores = [] } = {}) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/.next/**',
        '**/coverage/**',
        '**/generated/**',
        '**/.turbo/**',
        '**/node_modules/**',
        ...ignores,
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: { allowDefaultProject: ['*.js', '*.mjs', '*.ts'] },
          tsconfigRootDir,
        },
      },
      rules: {
        ...boundaryRules,
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        // Swallowed errors hide failures — every catch must do something.
        'no-empty': ['error', { allowEmptyCatch: false }],
        'no-console': 'error',
        eqeqeq: ['error', 'always'],
      },
    },
    {
      // Plain JS and root-level tool config files are not part of any tsconfig project.
      files: ['**/*.js', '**/*.mjs', '**/*.cjs', '*.config.ts'],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/require-await': 'off',
      },
    },
    prettier,
  );
}
