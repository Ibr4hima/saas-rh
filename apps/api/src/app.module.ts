import { Module } from '@nestjs/common';
import { EncryptionService } from './common/encryption.service';
import { DashboardController } from './modules/analytics/dashboard.controller';
import { TenantDb } from './db/tenant-db';
import { AuthController } from './modules/auth/auth.controller';
import { EmployeeDocumentsController } from './modules/docs/employee-documents.controller';
import { EmployeeDocumentsService } from './modules/docs/employee-documents.service';
import { NotificationsController } from './modules/notifications/notifications.controller';
import { NotificationsService } from './modules/notifications/notifications.service';
import { AttestationService } from './modules/documents/attestation.service';
import { DocumentsController } from './modules/documents/documents.controller';
import { AuthService } from './modules/auth/auth.service';
import { RolesGuard } from './modules/auth/roles.guard';
import { SessionGuard } from './modules/auth/session.guard';
import { HealthController } from './modules/health/health.controller';
import { OrgUnitsService } from './modules/people/org-units.service';
import { PeopleController } from './modules/people/people.controller';
import { PeopleService } from './modules/people/people.service';
import { InvitationsService } from './modules/portal/invitations.service';
import { PortalController } from './modules/portal/portal.controller';
import { ApplyService } from './modules/recruitment/apply.service';
import { JobsService } from './modules/recruitment/jobs.service';
import {
  PublicJobsController,
  RecruitmentController,
} from './modules/recruitment/recruitment.controller';
import { AbsencesController } from './modules/time/absences.controller';
import { AbsencesService } from './modules/time/absences.service';

/**
 * Monolithe modulaire (ADR-0001) : un module Nest par bounded context à mesure
 * qu'ils naissent (people, time, payroll…). Phase 0 : socle auth + santé.
 */
@Module({
  controllers: [
    HealthController,
    AuthController,
    PeopleController,
    AbsencesController,
    DashboardController,
    PortalController,
    DocumentsController,
    EmployeeDocumentsController,
    NotificationsController,
    RecruitmentController,
    PublicJobsController,
  ],
  providers: [
    TenantDb,
    EncryptionService,
    AuthService,
    SessionGuard,
    RolesGuard,
    PeopleService,
    OrgUnitsService,
    AbsencesService,
    InvitationsService,
    AttestationService,
    EmployeeDocumentsService,
    NotificationsService,
    JobsService,
    ApplyService,
  ],
})
export class AppModule {}
