#!/usr/bin/env node
// Copies every <app>/.env.example to <app>/.env when .env does not exist yet. Never overwrites.
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

for (const app of readdirSync('apps')) {
  const example = join('apps', app, '.env.example');
  const target = join('apps', app, '.env');
  if (existsSync(example) && !existsSync(target)) {
    copyFileSync(example, target);
    console.log(`created ${target}`);
  }
}
