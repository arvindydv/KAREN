import { Global, Module } from '@nestjs/common';
import { ExecutionPolicyService } from './execution-policy.service.js';

@Global()
@Module({ providers: [ExecutionPolicyService], exports: [ExecutionPolicyService] })
export class PolicyModule {}
