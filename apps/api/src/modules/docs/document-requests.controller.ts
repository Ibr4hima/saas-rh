import {
  Body,
  Controller,
  Delete,
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
import {
  advanceDocumentRequestSchema,
  batchAdvanceDocumentRequestSchema,
  createDocumentRequestSchema,
  deposerFichierSchema,
  documentRequestStatusSchema,
  type AdvanceDocumentRequestInput,
  type BatchAdvanceDocumentRequestInput,
  type CreateDocumentRequestInput,
  type DeposerFichierInput,
} from '@teranga/contracts';
import { z } from 'zod';
import { contentDisposition } from '../../common/telechargement';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { DocumentRequestsService } from './document-requests.service';

const listQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  status: documentRequestStatusSchema.optional(),
  /** « mine » force le périmètre personnel, même pour un rôle RH. */
  scope: z.literal('mine').optional(),
});

@Controller()
@UseGuards(SessionGuard, AccesGuard)
export class DocumentRequestsController {
  constructor(
    @Inject(DocumentRequestsService) private readonly requests: DocumentRequestsService,
  ) {}

  /** L'employé formule sa demande depuis son espace. */
  @Post('document-requests')
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createDocumentRequestSchema)) body: CreateDocumentRequestInput,
  ) {
    return this.requests.create(req.sessionUser, body);
  }

  /** File RH (tout le tenant) ou historique personnel selon le rôle. */
  @Get('document-requests')
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.requests.list(req.sessionUser, query);
  }

  /**
   * Même geste sur plusieurs demandes. Déclaré AVANT la route paramétrée :
   * sans quoi « batch-advance » serait lu comme un identifiant.
   */
  @Post('document-requests/batch-advance')
  batchAdvance(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(batchAdvanceDocumentRequestSchema))
    body: BatchAdvanceDocumentRequestInput,
  ) {
    return this.requests.batchAdvance(req.sessionUser, body);
  }

  /** L'agent retire sa demande, tant qu'elle n'est pas prête. */
  @Post('document-requests/:id/cancel')
  @HttpCode(204)
  async cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.requests.cancel(req.sessionUser, id);
  }

  @Post('document-requests/:id/advance')
  @HttpCode(204)
  async advance(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(advanceDocumentRequestSchema)) body: AdvanceDocumentRequestInput,
  ) {
    await this.requests.advance(req.sessionUser, id, body);
  }

  /** Qui traite la demande y dépose le document : l'agent le reçoit dans son espace. */
  @Post('document-requests/:id/fichiers')
  deposer(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deposerFichierSchema)) body: DeposerFichierInput,
  ) {
    return this.requests.deposer(req.sessionUser, id, body);
  }

  @Delete('document-requests/:id/fichiers/:fichierId')
  @HttpCode(204)
  async retirerFichier(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fichierId', ParseUUIDPipe) fichierId: string,
  ) {
    await this.requests.retirerFichier(req.sessionUser, id, fichierId);
  }

  /** Le document remis, à enregistrer. */
  @Get('document-requests/:id/fichiers/:fichierId')
  async fichier(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fichierId', ParseUUIDPipe) fichierId: string,
    @Res() res: Response,
  ) {
    const f = await this.requests.fichier(req.sessionUser, id, fichierId);
    res.setHeader('Content-Type', f.contentType);
    res.setHeader('Content-Disposition', contentDisposition('attachment', f.filename));
    res.setHeader('Cache-Control', 'no-store');
    res.end(f.data);
  }
}
