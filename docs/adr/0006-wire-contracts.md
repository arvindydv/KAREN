# 0006 — Wire contracts

- Status: Accepted · Date: 2026-11-19

## Decision

- **snake_case JSON** on every wire (public API and internal), matching the product spec's examples and Python conventions. TypeScript internals stay camelCase.
- **Public API:** zod schemas in `@karen/api-contracts` are the source of truth. Controllers validate with `ZodValidationPipe` and document with `ApiZodBody/ApiZodResponse` (`z.toJSONSchema`, OpenAPI 3.0 target). `pnpm contracts:generate` emits `packages/api-contracts/openapi/karen-api.v1.json` from the real Nest app and generates `src/generated/schema.ts` with `openapi-typescript`; clients use the `openapi-fetch` wrapper `createKarenApiClient`. CI fails on drift (`pnpm contracts:check`).
- URI versioning (`/v1/...`); health endpoints are version-neutral.
- **AI service contract:** zod in `@karen/ai-model-contracts` + Pydantic mirror in `apps/ai-service/src/karen_ai/contracts.py`, both strict. `CONTRACT_VERSION` must match; both test suites validate the same JSON fixtures in `packages/ai-model-contracts/fixtures/`.
- Standard error envelope `{ error: { code, message, correlation_id, retryable, next_options?, details? } }`.
