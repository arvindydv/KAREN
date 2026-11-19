import { ProviderCapabilityUnavailableError } from '@karen/domain';
import type { Logger } from '@karen/observability';
import Fastify, { type FastifyInstance } from 'fastify';
import { UnknownProviderError, type ProviderRegistry } from './adapters/registry.js';
import type { InboundEventSink } from './webhooks/inbound-sink.js';
import type { ReplayGuard } from './webhooks/replay-guard.js';

export interface ServerDeps {
  registry: ProviderRegistry;
  replayGuard: ReplayGuard;
  sink: InboundEventSink;
  log: Logger;
  isReady: () => boolean;
  now?: () => number;
}

/**
 * HTTP surface of the provider worker: health probes and signed provider webhooks.
 * Webhook handling: raw body → provider-specific signature verification → replay guard →
 * sink. Rejections reveal nothing beyond a generic status.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  // Keep the exact raw bytes: signatures are computed over them, not over re-serialised JSON.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/health/live', () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    const ready = deps.isReady();
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready' });
  });

  app.post<{ Params: { providerId: string } }>('/webhooks/:providerId', async (req, reply) => {
    const { providerId } = req.params;
    let adapter;
    try {
      adapter = deps.registry.require(providerId, 'webhook');
    } catch (error) {
      if (
        error instanceof UnknownProviderError ||
        error instanceof ProviderCapabilityUnavailableError
      ) {
        return reply.status(404).send({ error: 'not_found' });
      }
      throw error;
    }
    const raw = typeof req.body === 'string' ? req.body : '';
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
    const result = adapter.verifyWebhook?.(raw, headers, now());
    if (!result?.ok) {
      deps.log.warn(
        { provider_id: providerId, reason: result?.reason ?? 'UNSUPPORTED' },
        'provider.webhook.rejected',
      );
      return reply
        .status(result?.reason === 'INVALID_PAYLOAD' ? 400 : 401)
        .send({ error: 'rejected' });
    }
    const first = await deps.replayGuard.claim(providerId, result.event.eventId);
    if (!first) {
      deps.log.info(
        { provider_id: providerId, event_id: result.event.eventId },
        'provider.webhook.duplicate',
      );
      return reply.status(200).send({ status: 'duplicate_ignored' });
    }
    await deps.sink.accept(providerId, result.event);
    return reply.status(202).send({ status: 'accepted' });
  });

  return app;
}
