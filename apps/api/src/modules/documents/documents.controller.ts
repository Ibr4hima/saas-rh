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
import type { AttestationApercu } from '@teranga/contracts';
import { AccesGuard } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AttestationService } from './attestation.service';
import { contentDisposition } from '../../common/telechargement';

@Controller()
@UseGuards(SessionGuard, AccesGuard)
export class DocumentsController {
  constructor(@Inject(AttestationService) private readonly attestations: AttestationService) {}

  /** L'attestation d'un agent, depuis la file des documents (qui traite sa demande). */
  @Get('employees/:id/attestation')
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

  /** Ses textes, tels que le PDF les imprime : l'aperçu de la file. */
  @Get('employees/:id/attestation/apercu')
  attestationApercu(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttestationApercu> {
    return this.attestations.apercu(req.sessionUser, id);
  }

  private send(res: Response, filename: string, pdf: Buffer, inline = false) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      contentDisposition(inline ? 'inline' : 'attachment', filename),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }
}
