import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { DashboardContractFollowUp } from '@teranga/contracts';
import { TenantDb } from '../../db/tenant-db';
import { AccesGuard, Peut } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { suiviDesContrats } from './suivi-contrats';

/** « Échéances de contrat » : tous les CDD et stages en cours, les plus proches du terme d'abord. */
@Controller()
@UseGuards(SessionGuard, AccesGuard)
@Peut('contrats.echeances', 'pilotage')
export class SuiviContratsController {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  @Get('contrats/suivi')
  suivi(@Req() req: AuthenticatedRequest): Promise<DashboardContractFollowUp[]> {
    const user = req.sessionUser;
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      suiviDesContrats(tx),
    );
  }
}
