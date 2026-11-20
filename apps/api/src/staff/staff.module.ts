import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiEnv } from '../config/env.js';
import { API_ENV } from '../config/config.module.js';
import { PrismaService } from '../infrastructure/database/prisma.service.js';
import { StaffAdminService } from './staff-admin.service.js';
import { STAFF_DB, StaffAuthService } from './staff-auth.service.js';
import {
  AdminSystemController,
  StaffAdminController,
  StaffAuthController,
} from './staff.controller.js';
import { StaffAuthGuard } from './staff.guard.js';

/**
 * Staff realm (ADR-0017). Registered ONLY when STAFF_AUTH_ENABLED=true; otherwise no staff or
 * admin route exists (404). Uses its own connection pool on the least-privilege staff DB role.
 */
@Module({})
export class StaffModule {
  static forRoot(env: ApiEnv): DynamicModule {
    if (!env.STAFF_AUTH_ENABLED) return { module: StaffModule };
    return {
      module: StaffModule,
      controllers: [StaffAuthController, StaffAdminController, AdminSystemController],
      providers: [
        {
          provide: STAFF_DB,
          inject: [API_ENV],
          useFactory: (e: ApiEnv) =>
            new PrismaService({
              ...e,
              DATABASE_URL: e.STAFF_DATABASE_URL ?? '',
              DATABASE_POOL_MAX: 5,
            }),
        },
        StaffAuthService,
        StaffAdminService,
        StaffAuthGuard,
      ],
      exports: [StaffAuthService],
    };
  }
}
