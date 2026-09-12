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
  createProfileChangeRequestSchema,
  decideProfileChangeRequestSchema,
  profileChangeStatusSchema,
  type CreateProfileChangeRequestInput,
  type DecideProfileChangeRequestInput,
} from '@teranga/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ProfileChangesService } from './profile-changes.service';

const listQuerySchema = z.object({
  employeeId: z.uuid().optional(),
  status: profileChangeStatusSchema.optional(),
  /** « mine » force le périmètre personnel, même pour un rôle RH. */
  scope: z.literal('mine').optional(),
});

@Controller()
@UseGuards(SessionGuard, RolesGuard)
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

  @Post('profile-changes/:id/decide')
  @Roles('admin', 'hr')
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
