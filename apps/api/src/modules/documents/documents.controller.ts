import { Controller, Get, Inject, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
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
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.attestations.forEmployee(req.sessionUser, id);
    this.send(res, filename, pdf);
  }

  private send(res: Response, filename: string, pdf: Buffer) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }
}
