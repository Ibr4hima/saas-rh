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
  UseGuards,
} from '@nestjs/common';
import {
  advanceDocumentRequestSchema,
  batchAdvanceDocumentRequestSchema,
  createDocumentRequestSchema,
  documentRequestStatusSchema,
  type AdvanceDocumentRequestInput,
  type BatchAdvanceDocumentRequestInput,
  type CreateDocumentRequestInput,
} from '@teranga/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { DocumentRequestsService } from './document-requests.service';

const listQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  status: documentRequestStatusSchema.optional(),
  /** « mine » force le périmètre personnel, même pour un rôle RH. */
  scope: z.literal('mine').optional(),
});

@Controller()
@UseGuards(SessionGuard, RolesGuard)
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
  @Roles('admin', 'hr')
  batchAdvance(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(batchAdvanceDocumentRequestSchema))
    body: BatchAdvanceDocumentRequestInput,
  ) {
    return this.requests.batchAdvance(req.sessionUser, body);
  }

  @Post('document-requests/:id/advance')
  @Roles('admin', 'hr')
  @HttpCode(204)
  async advance(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(advanceDocumentRequestSchema)) body: AdvanceDocumentRequestInput,
  ) {
    await this.requests.advance(req.sessionUser, id, body);
  }
}
