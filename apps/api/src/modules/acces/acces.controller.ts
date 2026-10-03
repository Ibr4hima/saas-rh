import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  accorderSchema,
  confierSchema,
  type AccorderInput,
  type ConfierInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { TenantDb } from '../../db/tenant-db';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { confierLaDemande, TYPES_DCH, type TypeDCH } from './demandes';
import { HabilitationsService } from './habilitations.service';

const typeDCHSchema = z.enum(TYPES_DCH as [TypeDCH, ...TypeDCH[]]);

@Controller()
@UseGuards(SessionGuard)
export class AccesController {
  constructor(
    @Inject(HabilitationsService) private readonly habilitations: HabilitationsService,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  /** Les délégations du directeur du Capital Humain. */
  @Get('habilitations')
  etat(@Req() req: AuthenticatedRequest) {
    return this.habilitations.etat(req.sessionUser);
  }

  @Put('habilitations')
  @HttpCode(204)
  async accorder(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(accorderSchema)) body: AccorderInput,
  ) {
    await this.habilitations.accorder(req.sessionUser, body);
  }

  /**
   * Confier une demande de documents, d'informations ou une pièce à un
   * membre de la DCH — ou la reprendre. Les congés ont la leur
   * (absence-requests/:id/confier) : leur circuit a une étape de plus.
   */
  @Post('demandes/:type/:id/confier')
  @HttpCode(200)
  confier(
    @Req() req: AuthenticatedRequest,
    @Param('type', new ZodValidationPipe(typeDCHSchema)) type: TypeDCH,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confierSchema)) body: ConfierInput,
  ) {
    const user = req.sessionUser;
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      confierLaDemande(tx, user, type, id, body.employeeId),
    );
  }
}
