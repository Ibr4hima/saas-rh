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
import {
  createProfileChangeRequestSchema,
  decideProfileChangeRequestSchema,
  profileChangeStatusSchema,
  type CreateProfileChangeRequestInput,
  type DecideProfileChangeRequestInput,
} from '@teranga/contracts';
import type { Response } from 'express';
import { z } from 'zod';
import { contentDisposition } from '../../common/telechargement';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ProfileChangesService } from './profile-changes.service';

const listQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  status: profileChangeStatusSchema.optional(),
  /** « mine » force le périmètre personnel, même pour un rôle RH. */
  scope: z.literal('mine').optional(),
});

@Controller()
@UseGuards(SessionGuard, AccesGuard)
export class ProfileChangesController {
  constructor(@Inject(ProfileChangesService) private readonly requests: ProfileChangesService) {}

  /** L'employé signale un changement sur SON dossier. */
  @Post('profile-changes')
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createProfileChangeRequestSchema))
    body: CreateProfileChangeRequestInput,
  ) {
    return this.requests.create(req.sessionUser, body);
  }

  /** File RH (tout le tenant) ou historique personnel selon le rôle. */
  @Get('profile-changes')
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.requests.list(req.sessionUser, query);
  }

  /**
   * Le certificat de mariage joint à une demande en attente (ADR-0080).
   * Aperçu dans la page par défaut ; ?download=1 force le téléchargement.
   */
  @Get('profile-changes/:id/certificat')
  async certificat(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ) {
    const piece = await this.requests.certificat(req.sessionUser, id);
    res.setHeader('Content-Type', piece.contentType);
    res.setHeader(
      'Content-Disposition',
      contentDisposition(download ? 'attachment' : 'inline', piece.filename),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(piece.data);
  }

  /** L'agent retire sa demande, tant qu'elle attend. */
  @Post('profile-changes/:id/cancel')
  @HttpCode(204)
  async cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.requests.cancel(req.sessionUser, id);
  }

  @Post('profile-changes/:id/decide')
  @HttpCode(204)
  async decide(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideProfileChangeRequestSchema))
    body: DecideProfileChangeRequestInput,
  ) {
    await this.requests.decide(req.sessionUser, id, body);
  }
}
