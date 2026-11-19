#!/usr/bin/env node
// Cross-platform runner for the core local stack: API, AI service, Temporal worker and
// provider worker, with prefixed output. Requires `pnpm infra:up` (Postgres, Redis, Temporal).
import { spawn } from 'node:child_process';

const processes = [
  ['api', 'pnpm', ['--filter', '@karen/api', 'dev']],
  [
    'ai',
    'uv',
    ['run', '--project', 'apps/ai-service', '--directory', 'apps/ai-service', 'karen-ai-dev'],
  ],
  ['temporal', 'pnpm', ['--filter', '@karen/temporal-worker', 'dev']],
  ['provider', 'pnpm', ['--filter', '@karen/provider-worker', 'dev']],
];

const colors = ['\x1b[36m', '\x1b[35m', '\x1b[33m', '\x1b[32m'];
const children = processes.map(([name, cmd, args], i) => {
  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const prefix = `${colors[i % colors.length]}[${name}]\x1b[0m `;
  const pipe = (stream, out) =>
    stream.on('data', (buf) => {
      for (const line of buf.toString().split('\n')) if (line) out.write(prefix + line + '\n');
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stderr.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 5000).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
