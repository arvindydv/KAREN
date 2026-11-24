/**
 * Architectural rules for apps/api, enforced in `pnpm lint`.
 *  - no circular imports
 *  - feature modules talk to each other only through injected services, never by reaching
 *    into another module's controllers
 *  - infrastructure never depends on feature modules
 *  - the generated Prisma client is only used by infrastructure and services, not controllers
 */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'infrastructure-is-leaf',
      severity: 'error',
      from: { path: '^src/infrastructure' },
      to: {
        path: '^src/(identity|consent|audit|policy|admin|health|auth|security|onboarding|data-rights|conversation|memory)/',
      },
    },
    {
      // Security primitives (hashing, policy, gates, opaque tokens) are pure and reusable:
      // no database, no feature modules (ADR-0015).
      name: 'security-is-leaf',
      severity: 'error',
      from: { path: '^src/security/', pathNot: '\\.module\\.ts$' },
      to: {
        path: '^src/(identity|consent|audit|policy|admin|health|auth|infrastructure|generated|onboarding|data-rights|conversation)/',
      },
    },
    {
      // Phase 03 (ADR-0036 §5.4): memory depends on consent data, audit and infrastructure only;
      // it must never import the conversation module (conversation depends on memory).
      name: 'memory-does-not-import-conversation',
      severity: 'error',
      from: { path: '^src/memory/' },
      to: { path: '^src/(conversation|data-rights)/' },
    },
    {
      // Other modules use only memory's narrow services, never its repository/internals.
      name: 'memory-narrow-interface',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/memory/' },
      to: {
        path: '^src/memory/',
        pathNot:
          '^src/memory/(memory\\.module|memory-consent|memory-deletion\\.service|memory-export\\.service)\\.ts$',
      },
    },
    {
      name: 'no-controller-imports-across-modules',
      severity: 'error',
      from: { path: '^src/([^/]+)/' },
      to: { path: '^src/([^/]+)/.+\\.controller\\.ts$', pathNot: '^src/$1/' },
    },
    {
      name: 'controllers-do-not-touch-prisma-directly',
      severity: 'error',
      from: { path: '\\.controller\\.ts$' },
      to: { path: '^src/generated/prisma' },
    },
    {
      name: 'no-test-code-in-src',
      severity: 'error',
      from: { path: '^src/', pathNot: '\\.test\\.ts$' },
      to: { path: '^test/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^src/generated' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default', 'types'],
    },
  },
};
