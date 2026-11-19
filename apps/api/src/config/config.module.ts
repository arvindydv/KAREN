import { Global, Module } from '@nestjs/common';
import { loadApiEnv, type ApiEnv } from './env.js';

export const API_ENV = Symbol('API_ENV');

/** Validated configuration, loaded once (fail-fast) and injected everywhere via API_ENV. */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env?: ApiEnv) {
    return {
      module: ConfigModule,
      providers: [{ provide: API_ENV, useValue: env ?? loadApiEnv() }],
      exports: [API_ENV],
    };
  }
}
