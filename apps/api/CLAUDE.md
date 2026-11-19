# apps/api — rules

- Every route is authenticated unless decorated `@Public()` (health and the local-dev token route only). Staff routes use `@RequirePermissions(...)`; permissions derive from DB role grants.
- Get the user from `@CurrentPrincipal()` — never from body/query/path. Scope every query by `principal.userId`.
- Validate input with `ZodBody/ZodQuery` using schemas from `@karen/api-contracts`; document responses with `ApiZodResponse`. Then `pnpm contracts:generate` and commit.
- Throw `ApiError(code, safeMessage)` for client-visible errors; never leak internal details.
- Data access goes through services; controllers never import the Prisma client (dependency-cruiser enforces). Use `withTransaction` for multi-row changes; write audit/outbox rows in the same transaction.
- New domain → new module folder + new Postgres schema; update `docs/architecture/service-boundaries.md` and dependency-cruiser rules.
- Never call the AI gateway directly — use `AiServiceClient` (signed internal calls).
- Commands: `pnpm --filter @karen/api {dev,test,test:integration,lint,typecheck,db:migrate,db:seed}`.
