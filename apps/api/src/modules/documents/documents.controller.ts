import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AttestationService } from './attestation.service';

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class DocumentsController {
  constructor(@Inject(AttestationService) private readonly attestations: AttestationService) {}

  /** Depuis la fiche : la RH génère l'attestation d'un employé. */
  @Get('employees/:id/attestation')
  @Roles('admin', 'hr')
  async employeeAttestation(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    // « inline » ouvre le PDF dans la visionneuse du navigateur au lieu de le
    // déposer dans les téléchargements : c'est le mode de la file RH, qui
    // relit l'attestation avant de la faire signer, puis l'imprime de là.
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.attestations.forEmployee(req.sessionUser, id);
    this.send(res, filename, pdf, disposition === 'inline');
  }

  private send(res: Response, filename: string, pdf: Buffer, inline = false) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }
}
