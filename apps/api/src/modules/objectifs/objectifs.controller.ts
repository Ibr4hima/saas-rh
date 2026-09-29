import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  anneeQuerySchema,
  creerObjectifSchema,
  evaluerObjectifSchema,
  modifierObjectifSchema,
  type CreerObjectifInput,
  type EvaluerObjectifInput,
  type ModifierObjectifInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ObjectifsService } from './objectifs.service';

/**
 * Les objectifs : ouverts à tout agent, bornés par l'organigramme — le
 * service ne laisse fixer que ce que la place de l'appelant lui donne.
 */
@Controller('objectifs')
@UseGuards(SessionGuard, AccesGuard)
export class ObjectifsController {
  constructor(@Inject(ObjectifsService) private readonly objectifs: ObjectifsService) {}

  @Get('moi')
  mesObjectifs(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(anneeQuerySchema)) q: { annee?: number },
  ) {
    return this.objectifs.mesObjectifs(req.sessionUser, q.annee);
  }

  @Get('equipe')
  suiviEquipe(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(anneeQuerySchema)) q: { annee?: number },
  ) {
    return this.objectifs.suiviEquipe(req.sessionUser, q.annee);
  }

  @Get('equipe/:employeeId')
  fiche(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query(new ZodValidationPipe(anneeQuerySchema)) q: { annee?: number },
  ) {
    return this.objectifs.fiche(req.sessionUser, employeeId, q.annee);
  }

  @Get('formations')
  formations(@Req() req: AuthenticatedRequest) {
    return this.objectifs.formationsProposables(req.sessionUser);
  }

  @Get('apix')
  apix(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(anneeQuerySchema)) q: { annee?: number },
  ) {
    return this.objectifs.objectifsAPIX(req.sessionUser, q.annee);
  }

  @Post()
  creer(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(creerObjectifSchema)) body: CreerObjectifInput,
  ) {
    return this.objectifs.creer(req.sessionUser, body);
  }

  @Patch(':id')
  modifier(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(modifierObjectifSchema)) body: ModifierObjectifInput,
  ) {
    return this.objectifs.modifier(req.sessionUser, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async supprimer(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.objectifs.supprimer(req.sessionUser, id);
  }

  @Post(':id/evaluation')
  evaluer(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(evaluerObjectifSchema)) body: EvaluerObjectifInput,
  ) {
    return this.objectifs.evaluer(req.sessionUser, id, body);
  }
}
