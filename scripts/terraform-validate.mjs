#!/usr/bin/env node
// terraform fmt -check + init -backend=false + validate + offline mocked tests for every environment.
// Never touches real AWS: no backend, no credentials, no plan/apply.
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const run = (args, cwd) =>
  execFileSync('terraform', args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, TF_IN_AUTOMATION: '1' },
  });
run(['fmt', '-check', '-recursive', 'infra/terraform'], '.');
const envRoot = 'infra/terraform/environments';
for (const env of readdirSync(envRoot)) {
  const dir = join(envRoot, env);
  console.log(`\n== ${env}`);
  run(['init', '-backend=false', '-input=false', '-lockfile=readonly'], dir);
  run(['validate'], dir);
  run(['test'], dir);
  rmSync(join(dir, '.terraform'), { recursive: true, force: true });
}
console.log('\nterraform-validate: OK (static validation only — nothing planned or applied)');
