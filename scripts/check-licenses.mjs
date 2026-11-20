// License gate for PRODUCTION npm dependencies (CI `security` job; roadmap F00-01).
// Denies strong/network copyleft unless a permissive alternative is offered (SPDX "OR").
// Weak-copyleft / source-available / unknown licenses need an explicit, reasoned exception.
//   node scripts/check-licenses.mjs
import { execFileSync } from 'node:child_process';

const DENY = /\b(A?GPL|SSPL|EUPL|OSL|RPL|CPAL|Commons-Clause)\b/i;
const REVIEW = /\b(LGPL|MPL|EPL|CDDL|FSL|BUSL|CC-BY-SA|Unknown|UNLICENSED|SEE LICENSE)\b/i;

/** package name -> reason. Every entry was reviewed; remove it when the package goes away. */
const EXCEPTIONS = {
  '@img/sharp-libvips-linux-x64':
    'LGPL-3.0: unmodified libvips shared library loaded dynamically by sharp (Next.js images)',
  elkjs:
    'EPL-2.0 weak copyleft: transitive via @prisma/client tooling, used unmodified; no derivative distributed',
  sentry:
    'FSL-1.1-Apache-2.0: source-available, converts to Apache-2.0; we do not compete with Sentry',
  unionfs:
    'package.json has no license field; bundled LICENSE file is the Unlicense (public domain). Pulled in by @temporalio/worker',
  lightningcss: 'MPL-2.0 file-level copyleft: used unmodified as a build tool',
  'lightningcss-linux-x64-gnu': 'MPL-2.0 file-level copyleft: native binary of lightningcss',
};

/** An SPDX expression is acceptable if any OR-alternative avoids the deny list. */
const hasPermissiveAlternative = (license) =>
  license
    .replace(/[()]/g, '')
    .split(/\s+OR\s+/i)
    .some((alt) => !DENY.test(alt) && !REVIEW.test(alt));

const raw = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(raw);
const problems = [];
const accepted = [];
for (const [license, packages] of Object.entries(byLicense)) {
  if (hasPermissiveAlternative(license)) continue;
  for (const pkg of packages) {
    const id = `${pkg.name}@${(pkg.versions ?? []).join('|')} (${license})`;
    if (EXCEPTIONS[pkg.name]) accepted.push(`${id}: ${EXCEPTIONS[pkg.name]}`);
    else problems.push(`${id}: ${DENY.test(license) ? 'DENIED license' : 'needs review'}`);
  }
}
for (const a of accepted) process.stdout.write(`accepted exception  ${a}\n`);
if (problems.length > 0) {
  process.stderr.write(`License gate FAILED:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(`License gate passed (${Object.values(byLicense).flat().length} packages).\n`);
