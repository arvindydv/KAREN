#!/usr/bin/env node
/**
 * Downloads the on-device "Hello KAREN" speech model for the website (ADR-0031) and serves it
 * from KAREN's own origin (public/models/), so the browser never contacts a third party and room
 * audio never leaves the computer.
 *
 * Model: Vosk small Indian-English 0.4 (Apache-2.0, alphacephei.com). The archive is verified
 * against a pinned SHA-256 before use. Run once per checkout (and in the web build pipeline):
 *   pnpm --filter @karen/web wake-model:fetch
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const NAME = 'vosk-model-small-en-in-0.4';
const URL = `https://alphacephei.com/vosk/models/${NAME}.zip`;
const SHA256 = '20663dcac4d5cb783a579c54d98339344a688e4ec6e1b4a4b059fd1235454cc7';
const OUT_DIR = resolve(import.meta.dirname, '..', 'public', 'models');
const OUT = join(OUT_DIR, `${NAME}.tar.gz`);

if (existsSync(OUT) && !process.argv.includes('--force')) {
  process.stdout.write(`wake model already present: ${OUT}\n`);
  process.exit(0);
}
const res = await fetch(URL);
if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
const zip = Buffer.from(await res.arrayBuffer());
const digest = createHash('sha256').update(zip).digest('hex');
if (digest !== SHA256) throw new Error(`model checksum mismatch: ${digest}`);
const work = mkdtempSync(join(tmpdir(), 'karen-wake-'));
try {
  writeFileSync(join(work, 'model.zip'), zip);
  execFileSync('unzip', ['-q', join(work, 'model.zip'), '-d', work]);
  mkdirSync(OUT_DIR, { recursive: true });
  execFileSync('tar', ['-czf', OUT, '-C', work, NAME]);
  process.stdout.write(
    `wake model ready: ${OUT} (${(readFileSync(OUT).length / 1e6).toFixed(1)} MB)\n`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
