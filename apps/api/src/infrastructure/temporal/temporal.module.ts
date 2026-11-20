import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { API_ENV } from '../../config/config.module.js';
import type { ApiEnv } from '../../config/env.js';
import {
  ManualWorkflowStarter,
  TemporalWorkflowStarter,
  WORKFLOW_STARTER,
  type WorkflowStarter,
} from './workflow-starter.js';

@Global()
@Module({
  providers: [
    {
      provide: WORKFLOW_STARTER,
      inject: [API_ENV],
      useFactory: (env: ApiEnv): WorkflowStarter =>
        env.DATA_RIGHTS_DISPATCH === 'manual'
          ? new ManualWorkflowStarter()
          : new TemporalWorkflowStarter({
              address: env.TEMPORAL_ADDRESS,
              namespace: env.TEMPORAL_NAMESPACE,
              tls: env.TEMPORAL_TLS_ENABLED,
              apiKey: env.TEMPORAL_API_KEY,
            }),
    },
  ],
  exports: [WORKFLOW_STARTER],
})
export class TemporalModule implements OnModuleDestroy {
  constructor(@Inject(WORKFLOW_STARTER) private readonly starter: WorkflowStarter) {}
  onModuleDestroy(): Promise<void> {
    return this.starter.close();
  }
}
