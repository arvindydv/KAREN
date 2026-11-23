#!/usr/bin/env node
// Fails if any NEXT_PUBLIC_* / EXPO_PUBLIC_* variable name looks like a secret, in any
// .env.example or source file. Public prefixes are compiled into client bundles.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SECRET =
  /(SECRET|PASSWORD|PRIVATE|API_KEY|APIKEY|TOKEN|CREDENTIAL|DATABASE_URL|REDIS_URL|AI_GATEWAY|OPENROUTER)/i;
const PUBLIC = /\b((?:NEXT|EXPO)_PUBLIC_[A-Z0-9_]+)/g;
const SKIP = new Set([
  'node_modules',
  '.next',
  'dist',
  '.turbo',
  '.git',
  '.venv',
  '.expo',
  'coverage',
  '.expo-export-check',
  'scripts',
]);
const EXT = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|example)$/;

const offenders = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path);
    // Test files deliberately contain bad examples to prove the guard works.
    else if ((EXT.test(name) || name.startsWith('.env')) && !/\.test\.tsx?$/.test(name)) {
      for (const [, v] of readFileSync(path, 'utf8').matchAll(PUBLIC)) {
        if (SECRET.test(v)) offenders.push(`${path}: ${v}`);
      }
    }
  }
}
for (const root of ['apps', 'packages']) walk(root);
if (offenders.length) {
  console.error('Secret-looking public env variables found:\n' + offenders.join('\n'));
  process.exit(1);
}
console.log('check-public-env: OK (no secret-looking NEXT_PUBLIC_/EXPO_PUBLIC_ variables)');
