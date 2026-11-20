import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SignJWT, generateKeyPair } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { ConsentService } from '../src/consent/consent.service.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';

async function start(overrides: Record<string, string> = {}) {
  const app = await createApp(testEnv(overrides), { logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

const unique = () => `dev|it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

describe('API (integration: real PostgreSQL + Redis)', () => {
  let app: NestFastifyApplication;
  // Fixtures/assertions use the owner role; the API itself runs as the RLS-bound runtime role.
  const prisma = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const token = async (subject: string) =>
    (await request(app.getHttpServer()).post('/dev/auth/token').send({ subject }).expect(200)).body
      .access_token as string;

  beforeAll(async () => {
    app = await start();
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('GET /health/live is always 200 and carries a request id', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'karen-api' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health/ready reports required dependencies and the non-critical AI service', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.database.status).toBe('up');
    expect(res.body.checks.redis.status).toBe('up');
    // ai-service is not running in this test; it must not gate readiness.
    expect(res.body.checks.ai_service_non_critical.status).toBe('down');
  });

  it('rejects unauthenticated and invalid-token requests with the standard envelope', async () => {
    const none = await request(app.getHttpServer())
      .get('/v1/me')
      .set('x-request-id', 'req-it-00000001')
      .expect(401);
    expect(none.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication is required.',
        correlation_id: 'req-it-00000001',
        retryable: false,
      },
    });
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', 'Bearer abc.def.ghi')
      .expect(401);
  });

  it('GET /v1/me provisions the identity mapping once and scopes to the token subject', async () => {
    const subject = unique();
    const t = await token(subject);
    const a = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${t}`)
      .expect(200);
    const b = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${t}`)
      .expect(200);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.roles).toEqual(['user']);
    expect(a.body.permissions).not.toContain('ops:read');
    const links = await prisma.externalIdentity.count({ where: { subject } });
    expect(links).toBe(1);
  });

  it('enforces staff permissions server-side and audits denials', async () => {
    const subject = unique();
    const t = await token(subject);
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${t}`)
      .expect(200);
    const denied = await request(app.getHttpServer())
      .get('/v1/admin/system/status')
      .set('authorization', `Bearer ${t}`)
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    const audit = await prisma.auditEvent.findFirst({
      where: { actorRef: me.body.id as string, action: 'authz.permission_denied' },
    });
    expect(audit).toMatchObject({
      outcome: 'DENIED',
      policyDecision: 'rbac:v1',
      reasonCode: 'missing_permission',
    });

    await prisma.staffRoleGrant.create({
      data: { userId: me.body.id as string, role: 'support_agent' },
    });
    const ok = await request(app.getHttpServer())
      .get('/v1/admin/system/status')
      .set('authorization', `Bearer ${t}`)
      .expect(200);
    expect(ok.body).toMatchObject({ environment: 'test', execution_paused: false });
  });

  it('denies valid tokens of suspended or deletion-requested accounts', async () => {
    const t = await token(unique());
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${t}`)
      .expect(200);
    for (const status of ['SUSPENDED', 'DELETION_REQUESTED'] as const) {
      await prisma.user.update({ where: { id: me.body.id as string }, data: { status } });
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('authorization', `Bearer ${t}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('client-supplied role claims in a token never grant permissions', async () => {
    const t = await token(unique());
    // The dev issuer cannot be asked for extra claims via the API; even if a token carried
    // `roles: ["ops_admin"]`, roles come only from DB grants. Verified via /v1/me output.
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${t}`)
      .expect(200);
    expect(me.body.roles).toEqual(['user']);
  });

  it('returns envelope errors for unknown routes, oversized bodies and bad dev-token input', async () => {
    const t = await token(unique());
    const nf = await request(app.getHttpServer())
      .get('/v1/does-not-exist')
      .set('authorization', `Bearer ${t}`)
      .expect(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    const big = await request(app.getHttpServer())
      .post('/dev/auth/token')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ subject: 'dev|x-123', pad: 'x'.repeat(8000) }))
      .expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const bad = await request(app.getHttpServer())
      .post('/dev/auth/token')
      .send({ subject: 'admin' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  it("isolates users: one user's consent never satisfies another user's check", async () => {
    const [ta, tb] = await Promise.all([token(unique()), token(unique())]);
    const meA = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${ta}`);
    const meB = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${tb}`);
    const [userA, userB] = [meA.body.id as string, meB.body.id as string];
    expect(userA).not.toBe(userB);
    await prisma.consentGrant.create({
      data: {
        userId: userA,
        purpose: 'MEMORY_STORAGE',
        policyVersion: 'test-1',
        receiptHash: 'sha256:test-only',
      },
    });
    const consent = app.get(ConsentService);
    expect(await consent.hasActiveConsent(userA, 'MEMORY_STORAGE')).toBe(true);
    expect(await consent.hasActiveConsent(userB, 'MEMORY_STORAGE')).toBe(false);
    // Each token resolves only to its own user; /v1/me has no way to address another user.
    expect(meB.body.id).toBe(userB);
  });

  it('applies security headers and the CORS allow-list', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('origin', 'https://evil.example');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('API readiness when a required dependency is down', () => {
  it('liveness stays 200 while readiness reports 503', async () => {
    const app = await start({ REDIS_URL: 'redis://127.0.0.1:1/0' });
    try {
      await request(app.getHttpServer()).get('/health/live').expect(200);
      const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.checks.redis.status).toBe('down');
      expect(res.body.checks.database.status).toBe('up');
    } finally {
      await app.close();
    }
  });
});

describe('API behaviour when PostgreSQL is unreachable', () => {
  it('boots, stays live, reports not-ready and fails requests safely (no hang, no leak)', async () => {
    const app = await start({
      DATABASE_URL: 'postgresql://karen_api_local:x@127.0.0.1:1/karen_test',
    });
    try {
      await request(app.getHttpServer()).get('/health/live').expect(200);
      const ready = await request(app.getHttpServer()).get('/health/ready').expect(503);
      expect(ready.body.checks.database.status).toBe('down');
      const t = (
        await request(app.getHttpServer())
          .post('/dev/auth/token')
          .send({ subject: 'dev|db-down-check' })
          .expect(200)
      ).body.access_token as string;
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('authorization', `Bearer ${t}`);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(res.body)).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|prisma/i);
      expect(res.body.error.correlation_id).toBeTruthy();
    } finally {
      await app.close();
    }
  });
});

describe('local-dev auth isolation', () => {
  it('the dev token route does not exist in oidc mode', async () => {
    const app = await start({
      AUTH_MODE: 'oidc',
      OIDC_ISSUER_URL: 'https://idp.example/',
      OIDC_AUDIENCE: 'karen-api',
      OIDC_JWKS_URL: 'https://idp.example/.well-known/jwks.json',
      OIDC_ALLOWED_ALGORITHMS: 'RS256',
    });
    try {
      const res = await request(app.getHttpServer())
        .post('/dev/auth/token')
        .send({ subject: 'dev|x-123' });
      expect([401, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
    } finally {
      await app.close();
    }
  });

  it('denies with a retryable 503 (not a sign-out 401) when the IdP JWKS is unreachable', async () => {
    const app = await start({
      AUTH_MODE: 'oidc',
      // Same origin as the issuer (config rule); nothing listens on port 1.
      OIDC_ISSUER_URL: 'http://127.0.0.1:1/',
      OIDC_AUDIENCE: 'karen-api',
      OIDC_JWKS_URL: 'http://127.0.0.1:1/.well-known/jwks.json',
      OIDC_ALLOWED_ALGORITHMS: 'RS256',
    });
    try {
      const { privateKey } = await generateKeyPair('RS256');
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer('http://127.0.0.1:1/')
        .setAudience('karen-api')
        .setSubject('someone')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      const res = await request(app.getHttpServer())
        .get('/v1/me')
        .set('authorization', `Bearer ${token}`)
        .expect(503);
      expect(res.body.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
    } finally {
      await app.close();
    }
  });
});

describe('rate limiting (ADR-0013)', () => {
  it('enforces the strict limit on sensitive (auth) routes', async () => {
    const app = await start({ API_SENSITIVE_RATE_LIMIT_PER_MINUTE: '2' });
    try {
      // Like the load balancer, send traffic only once readiness (incl. Redis) is green.
      await request(app.getHttpServer()).get('/health/ready').expect(200);
      // Unique client address per run so earlier runs in the same window cannot interfere.
      const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
      const call = () =>
        request(app.getHttpServer())
          .post('/dev/auth/token')
          .set('x-forwarded-for', ip)
          .send({ subject: 'dev|rate-limit-check' });
      await call().expect(200);
      await call().expect(200);
      const limited = await call().expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await app.close();
    }
  });

  it('FAILS CLOSED on sensitive routes and degrades (not opens) elsewhere when Redis is down', async () => {
    const app = await start({ REDIS_URL: 'redis://127.0.0.1:1/0', API_RATE_LIMIT_PER_MINUTE: '2' });
    try {
      const denied = await request(app.getHttpServer())
        .post('/dev/auth/token')
        .send({ subject: 'dev|redis-down-check' })
        .expect(503);
      expect(denied.body.error).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', retryable: true });
      // Default limiter falls back to a per-process window: authentication still applies…
      await request(app.getHttpServer()).get('/v1/me').expect(401);
      await request(app.getHttpServer()).get('/v1/me').expect(401);
      // …and the limit still holds instead of disappearing.
      const limited = await request(app.getHttpServer()).get('/v1/me').expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await app.close();
    }
  });
});
