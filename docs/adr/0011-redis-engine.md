# 0011 — Redis engine and configuration

- Status: Accepted · Date: 2026-11-19

## Decision

Local: `redis:7.4.12-alpine`. Deployed: ElastiCache with the Redis-protocol-compatible **Valkey** engine (lower cost; see infra/terraform). Clients use `ioredis` and only RESP commands common to both.
Configuration accepts either `REDIS_URL` (local) or `REDIS_HOST/REDIS_PORT/REDIS_TLS/REDIS_AUTH_TOKEN` (as injected by ECS); `@karen/config.resolveRedisUrl` produces one URL.
Redis is never authoritative: rate limits, replay-guard keys, caches; every key namespaced `karen:<purpose>:` with a TTL.
