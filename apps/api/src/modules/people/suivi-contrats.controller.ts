import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import type { SuiviDesContrats } from '@teranga/contracts';
import { TenantDb } from '../../db/tenant-db';
import { AccesGuard, Peut } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { inactiverLesContratsEchus } from './activite';
import { contratsArrivesATerme, suiviDesContrats } from './suivi-contrats';

/**
 * « Échéances de contrat » : tous les CDD et stages en cours, les plus proches
 * du terme d'abord — et ceux qui viennent d'arriver à terme.
 */
@Controller()
@UseGuards(SessionGuard, AccesGuard)
@Peut('contrats.echeances', 'pilotage')
export class SuiviContratsController {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  @Get('contrats/suivi')
  async suivi(@Req() req: AuthenticatedRequest): Promise<SuiviDesContrats> {
    const user = req.sessionUser;
    const ctx = { tenantId: user.tenantId, userId: user.userId };
    // Ce qui est arrivé à terme passe d'abord dans les inactifs : les deux
    // listes se lisent justes.
    await this.db.withTenant(ctx, (tx) => inactiverLesContratsEchus(tx, user.tenantId));
    return this.db.withTenant(ctx, async (tx) => ({
      enCours: await suiviDesContrats(tx),
      arrivesATerme: await contratsArrivesATerme(tx),
    }));
  }
}
