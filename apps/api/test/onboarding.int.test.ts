import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { TEST_OWNER_DATABASE_URL, testEnv } from './env.js';
import { harness, startApp } from './support.js';

/** Phase 01 / M5: onboarding progress (integration). */
describe('onboarding (integration)', () => {
  let app: NestFastifyApplication;
  const owner = new PrismaService(testEnv({ DATABASE_URL: TEST_OWNER_DATABASE_URL }));
  const h = harness(() => app);

  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  const as = async (tag: string) => h.signIn(await h.activeAccount(tag));
  const get = (auth: string) => h.http().get('/v1/me/onboarding').set('authorization', auth);
  const step = (auth: string, s: string) =>
    h.http().put(`/v1/me/onboarding/steps/${s}`).set('authorization', auth);

  it('starts not_started and progresses step by step; retries are no-ops', async () => {
    const s = await as('onb');
    const fresh = await get(s.auth).expect(200);
    expect(fresh.body).toMatchObject({
      status: 'not_started',
      current_step: 'welcome',
      completed_steps: [],
    });
    await step(s.auth, 'welcome').expect(200);
    const again = await step(s.auth, 'welcome').expect(200);
    expect(again.body).toMatchObject({
      status: 'in_progress',
      completed_steps: ['welcome'],
      current_step: 'language',
    });
    // Out-of-order completion is allowed; current_step is the first gap.
    const out = await step(s.auth, 'privacy').expect(200);
    expect(out.body.completed_steps).toEqual(['welcome', 'privacy']);
    expect(out.body.current_step).toBe('language');
    await step(s.auth, 'not-a-step').expect(404);
  });

  it('concurrent progress from several devices converges without duplicates', async () => {
    const email = await h.activeAccount('multi');
    const [a, b] = [await h.signIn(email), await h.signIn(email)];
    const steps = ['welcome', 'language', 'about_you', 'preferences', 'accessibility'];
    await Promise.all(steps.flatMap((s) => [step(a.auth, s), step(b.auth, s), step(a.auth, s)]));
    const state = await get(b.auth).expect(200);
    expect(state.body.completed_steps).toEqual(steps);
    expect(await owner.onboardingProgress.count({ where: { userId: a.userId } })).toBe(1);
  });

  it('skip and resume are idempotent; completing a step after skipping resumes', async () => {
    const s = await as('skip');
    await h.http().post('/v1/me/onboarding/skip').set('authorization', s.auth).expect(200);
    const skipped = await h
      .http()
      .post('/v1/me/onboarding/skip')
      .set('authorization', s.auth)
      .expect(200);
    expect(skipped.body.status).toBe('skipped');
    // Skipping never blocks use of the product.
    await h.http().get('/v1/me/profile').set('authorization', s.auth).expect(200);
    const resumed = await step(s.auth, 'language').expect(200);
    expect(resumed.body.status).toBe('in_progress');
    await h.http().post('/v1/me/onboarding/skip').set('authorization', s.auth).expect(200);
    expect(
      (await h.http().post('/v1/me/onboarding/resume').set('authorization', s.auth).expect(200))
        .body.status,
    ).toBe('in_progress');
  });

  it('complete is final and idempotent (first completion time kept)', async () => {
    const s = await as('done');
    const first = await h
      .http()
      .post('/v1/me/onboarding/complete')
      .set('authorization', s.auth)
      .expect(200);
    const second = await h
      .http()
      .post('/v1/me/onboarding/complete')
      .set('authorization', s.auth)
      .expect(200);
    expect(second.body.completed_at).toBe(first.body.completed_at);
    expect(
      (await h.http().post('/v1/me/onboarding/skip').set('authorization', s.auth).expect(200)).body
        .status,
    ).toBe('completed');
    expect((await step(s.auth, 'welcome').expect(200)).body.status).toBe('completed');
  });

  it('is per user (RLS) and requires authentication', async () => {
    const a = await as('own-a');
    const b = await as('own-b');
    await step(a.auth, 'welcome').expect(200);
    expect((await get(b.auth)).body.completed_steps).toEqual([]);
    await h.http().get('/v1/me/onboarding').expect(401);
  });
});
