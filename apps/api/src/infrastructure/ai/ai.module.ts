import { Global, Module } from '@nestjs/common';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';
import { AiServiceClient } from './ai-service.client.js';

@Global()
@Module({
  providers: [
    {
      provide: AiServiceClient,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => new AiServiceClient(env),
    },
  ],
  exports: [AiServiceClient],
})
export class AiModule {}
