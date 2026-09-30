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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  anneeQuerySchema,
  autoEvaluationSchema,
  type AutoEvaluationInput,
  creerObjectifSchema,
  enregistrerFicheObjectifsSchema,
  type EnregistrerFicheObjectifsInput,
  evaluationSemestreSchema,
  type EvaluationSemestreInput,
  evaluerObjectifSchema,
  modifierObjectifSchema,
  periodeParamsSchema,
  type CreerObjectifInput,
  type EvaluerObjectifInput,
  type ModifierObjectifInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ObjectifsService } from './objectifs.service';

/** L'année et le semestre d'une fiche, lus dans l'adresse. */
interface Periode {
  annee: number;
  semestre: 1 | 2;
}

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

  @Put('equipe/:employeeId/fiche')
  enregistrerFiche(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(enregistrerFicheObjectifsSchema))
    body: EnregistrerFicheObjectifsInput,
  ) {
    return this.objectifs.enregistrerFiche(req.sessionUser, employeeId, body);
  }

  // ———————————————————————— l'évaluation du semestre

  @Put('moi/fiches/:annee/:semestre/auto-evaluation')
  enregistrerAutoEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
    @Body(new ZodValidationPipe(autoEvaluationSchema)) body: AutoEvaluationInput,
  ) {
    return this.objectifs.enregistrerAutoEvaluation(req.sessionUser, p.annee, p.semestre, body);
  }

  @Post('moi/fiches/:annee/:semestre/auto-evaluation/envoi')
  @HttpCode(204)
  async envoyerAutoEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
  ) {
    await this.objectifs.envoyerAutoEvaluation(req.sessionUser, p.annee, p.semestre);
  }

  @Post('moi/fiches/:annee/:semestre/signature')
  @HttpCode(204)
  async signerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
  ) {
    await this.objectifs.signerEvaluation(req.sessionUser, p.annee, p.semestre);
  }

  @Put('equipe/:employeeId/fiches/:annee/:semestre/evaluation')
  enregistrerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
    @Body(new ZodValidationPipe(evaluationSemestreSchema)) body: EvaluationSemestreInput,
  ) {
    return this.objectifs.enregistrerEvaluation(
      req.sessionUser,
      employeeId,
      p.annee,
      p.semestre,
      body,
    );
  }

  @Post('equipe/:employeeId/fiches/:annee/:semestre/evaluation/validation')
  @HttpCode(204)
  async validerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
  ) {
    await this.objectifs.validerEvaluation(req.sessionUser, employeeId, p.annee, p.semestre);
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
