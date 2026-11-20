// Argon2id parameter benchmark (ADR-0015 §Password storage). Reproducible input for choosing
// the versioned parameter set in src/security/password/password-hasher.ts.
//
//   node scripts/bench-password-hash.mjs [iterations=20] [concurrency=4]
//
// Measures single-hash latency (p50/p95/p99) and throughput at a fixed concurrency for the
// OWASP Password Storage Cheat Sheet / RFC 9106 candidate sets. Record the machine, Node
// version and results in docs/security/password-hashing-benchmark.md — never invent numbers.
import { hash, verify } from '@node-rs/argon2';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

const ITER = Number(process.argv[2] ?? 20);
const CONC = Number(process.argv[3] ?? 4);
const CANDIDATES = [
  { name: 'owasp-19MiB-t2-p1', memoryCost: 19_456, timeCost: 2, parallelism: 1 },
  { name: 'owasp-46MiB-t1-p1', memoryCost: 47_104, timeCost: 1, parallelism: 1 },
  { name: 'rfc9106-64MiB-t3-p1', memoryCost: 65_536, timeCost: 3, parallelism: 1 },
  { name: 'rfc9106-64MiB-t3-p4', memoryCost: 65_536, timeCost: 3, parallelism: 4 },
];
const PASSWORD = 'correct horse battery staple, but longer';
const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

process.stdout.write(
  `node ${process.version} · ${cpus()[0]?.model} · ${cpus().length} logical CPUs · ` +
    `${Math.round(totalmem() / 2 ** 30)} GiB · UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? '4 (default)'}\n`,
);
for (const c of CANDIDATES) {
  const opts = {
    algorithm: 2,
    memoryCost: c.memoryCost,
    timeCost: c.timeCost,
    parallelism: c.parallelism,
  };
  const encoded = await hash(PASSWORD, opts); // warm-up
  const samples = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now();
    await verify(encoded, PASSWORD);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const total = ITER * 2;
  const t0 = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next++ < total) await verify(encoded, PASSWORD);
    }),
  );
  const elapsed = (performance.now() - t0) / 1000;
  process.stdout.write(
    `${c.name.padEnd(22)} single verify p50=${pct(samples, 50).toFixed(1)}ms ` +
      `p95=${pct(samples, 95).toFixed(1)}ms p99=${pct(samples, 99).toFixed(1)}ms · ` +
      `throughput@${CONC}=${(total / elapsed).toFixed(1)}/s · mem/hash≈${(c.memoryCost / 1024).toFixed(0)}MiB\n`,
  );
}
