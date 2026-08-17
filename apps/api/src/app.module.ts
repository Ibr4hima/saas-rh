import { Module } from '@nestjs/common';
import { TenantDb } from './db/tenant-db';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { SessionGuard } from './modules/auth/session.guard';
import { HealthController } from './modules/health/health.controller';

/**
 * Monolithe modulaire (ADR-0001) : un module Nest par bounded context à mesure
 * qu'ils naissent (people, time, payroll…). Phase 0 : socle auth + santé.
 */
@Module({
  controllers: [HealthController, AuthController],
  providers: [TenantDb, AuthService, SessionGuard],
})
export class AppModule {}
