import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { saisiesDuDocumentSchema, type SaisiesDuDocument } from '@teranga/contracts';
import { AccesGuard } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AttestationService } from './attestation.service';
import { GenerationService } from './generation.service';
import { contentDisposition } from '../../common/telechargement';
import { ZodValidationPipe } from '../../common/zod.pipe';

@Controller()
@UseGuards(SessionGuard, AccesGuard)
export class DocumentsController {
  constructor(
    @Inject(AttestationService) private readonly attestations: AttestationService,
    @Inject(GenerationService) private readonly generation: GenerationService,
  ) {}

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

  /**
   * Un document de la liste, généré pour un agent depuis « Générer des
   * documents » (ADR-0085) ; « inline » l'ouvre dans la visionneuse du
   * navigateur, pour l'imprimer. Un document qui demande une saisie passe
   * par la route suivante.
   */
  @Get('employees/:id/generer/:type')
  async genere(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type') type: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.generation.pdf(req.sessionUser, type, id);
    this.send(res, filename, pdf, disposition === 'inline');
  }

  /**
   * Le même, avec ce que la DCH a saisi : le salaire de l'attestation de
   * revenu (ADR-0087). La page lit ses aperçus par ici. En POST, pour que le
   * montant reste hors de l'adresse ; rien ne se crée pour autant, d'où le 200.
   */
  @Post('employees/:id/generer/:type')
  @HttpCode(200)
  async genereAvecSaisies(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('type') type: string,
    @Body(new ZodValidationPipe(saisiesDuDocumentSchema)) saisies: SaisiesDuDocument,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.generation.pdf(req.sessionUser, type, id, saisies);
    this.send(res, filename, pdf);
  }

  /**
   * Un document sans agent, le contrat de stage (ADR-0094) : la personne
   * n'est pas encore dans l'application, sa fiche part dans le corps.
   */
  @Post('documents/generer/:type')
  @HttpCode(200)
  async genereSansAgent(
    @Req() req: AuthenticatedRequest,
    @Param('type') type: string,
    @Body() corps: unknown,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.generation.pdfSansAgent(req.sessionUser, type, corps);
    this.send(res, filename, pdf);
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
