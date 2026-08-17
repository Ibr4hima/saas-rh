import { Module } from '@nestjs/common';
import { EncryptionService } from './common/encryption.service';
import { TenantDb } from './db/tenant-db';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { RolesGuard } from './modules/auth/roles.guard';
import { SessionGuard } from './modules/auth/session.guard';
import { HealthController } from './modules/health/health.controller';
import { ImportService } from './modules/people/import.service';
import { OrgUnitsService } from './modules/people/org-units.service';
import { PeopleController } from './modules/people/people.controller';
import { PeopleService } from './modules/people/people.service';
import { AbsencesController } from './modules/time/absences.controller';
import { AbsencesService } from './modules/time/absences.service';

/**
 * Monolithe modulaire (ADR-0001) : un module Nest par bounded context à mesure
 * qu'ils naissent (people, time, payroll…). Phase 0 : socle auth + santé.
 */
@Module({
  controllers: [HealthController, AuthController, PeopleController, AbsencesController],
  providers: [
    TenantDb,
    EncryptionService,
    AuthService,
    SessionGuard,
    RolesGuard,
    PeopleService,
    OrgUnitsService,
    ImportService,
    AbsencesService,
  ],
})
export class AppModule {}
