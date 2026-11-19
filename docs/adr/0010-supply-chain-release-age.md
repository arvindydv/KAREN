# 0010 — Dependency pinning and minimum release age

- Status: Accepted · Date: 2026-11-19

## Decision

- All direct dependencies are pinned exactly; lockfiles (`pnpm-lock.yaml`, `uv.lock`) are committed and CI installs with `--frozen-lockfile` / `--frozen`.
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` (7 days): freshly published (possibly compromised) releases cannot enter the lockfile. Only an allow-listed set of packages may run install scripts (`onlyBuiltDependencies`).
- Python projects set `[tool.uv] exclude-newer` (~2 weeks) with one documented exception (`livekit-protocol`, earlier releases yanked).

## Consequences

`expo install --check` reports four Expo packages a few patch versions behind SDK 58's newest (`expo 58.0.24` vs `~58.0.26`, etc.) because those patches are under 7 days old. Re-run `expo install --fix` after they mature. This is a deliberate trade-off, not an incompatibility.
