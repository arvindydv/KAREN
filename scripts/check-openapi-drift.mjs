#!/usr/bin/env node
// Regenerates the OpenAPI document + typed client and fails if the committed copies differ.
import { execFileSync } from 'node:child_process';

execFileSync('pnpm', ['contracts:generate'], { stdio: 'inherit' });
try {
  execFileSync(
    'git',
    [
      'diff',
      '--exit-code',
      '--',
      'packages/api-contracts/openapi',
      'packages/api-contracts/src/generated',
    ],
    { stdio: 'inherit' },
  );
} catch {
  console.error('\nOpenAPI contract drift: run `pnpm contracts:generate` and commit the result.');
  process.exit(1);
}
console.log('check-openapi-drift: OK');
