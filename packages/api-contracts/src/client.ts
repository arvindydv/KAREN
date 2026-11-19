/**
 * Typed HTTP client for the KAREN public API, generated from the committed OpenAPI
 * document (openapi/karen-api.v1.json → src/generated/schema.ts). Used by web, admin
 * and mobile. Regenerate with `pnpm contracts:generate`; CI fails on drift.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/schema.js';

export type { paths } from './generated/schema.js';

export interface KarenApiClientOptions {
  baseUrl: string;
  /** Returns the current OIDC access token, or undefined when signed out. */
  getAccessToken?: () => Promise<string | undefined> | string | undefined;
  fetch?: typeof globalThis.fetch;
}

export function createKarenApiClient(options: KarenApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getAccessToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      if (!request.headers.has('x-request-id')) {
        request.headers.set('x-request-id', globalThis.crypto.randomUUID());
      }
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type KarenApiClient = ReturnType<typeof createKarenApiClient>;
