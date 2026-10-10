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
  statutObjectifSchema,
  type StatutObjectifInput,
  commentairesAgentSchema,
  type CommentairesAgentInput,
  creerObjectifSchema,
  datesEvaluationSchema,
  type DatesEvaluationInput,
  enregistrerFicheObjectifsSchema,
  type EnregistrerFicheObjectifsInput,
  evaluationN1Schema,
  type EvaluationN1Input,
  evaluerObjectifSchema,
  fixerObjectifsSchema,
  type FixerObjectifsInput,
  modifierObjectifSchema,
  periodeParamsSchema,
  type CreerObjectifInput,
  type EvaluerObjectifInput,
  type ModifierObjectifInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, FermeAuxInactifs, Peut } from '../auth/acces.guard';
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
@FermeAuxInactifs()
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

  /** Les évaluations validées d'un agent : la section « Évaluation » de son dossier. */
  @Get('dossiers/:employeeId/evaluations')
  evaluationsDe(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.objectifs.evaluationsDe(req.sessionUser, employeeId);
  }

  @Get('equipe/:employeeId')
  fiche(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query(new ZodValidationPipe(anneeQuerySchema)) q: { annee?: number },
  ) {
    return this.objectifs.fiche(req.sessionUser, employeeId, q.annee);
  }

  /** « Fixer des objectifs » : chacun va dans la fiche de l'évaluation où son échéance le fait compter. */
  @Post('equipe/:employeeId/objectifs')
  fixerObjectifs(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(fixerObjectifsSchema)) body: FixerObjectifsInput,
  ) {
    return this.objectifs.fixerObjectifs(req.sessionUser, employeeId, body);
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

  // ———————————————————————— le semestre : ce que l'agent en fait, ce que le n+1 en dit

  @Put('moi/fiches/:annee/:semestre/statuts')
  statuer(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
    @Body(new ZodValidationPipe(statutObjectifSchema)) body: StatutObjectifInput,
  ) {
    return this.objectifs.statuer(req.sessionUser, p.annee, p.semestre, body);
  }

  @Put('moi/fiches/:annee/:semestre/commentaires')
  @HttpCode(204)
  async enregistrerCommentaires(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
    @Body(new ZodValidationPipe(commentairesAgentSchema)) body: CommentairesAgentInput,
  ) {
    await this.objectifs.enregistrerCommentaires(req.sessionUser, p.annee, p.semestre, body);
  }

  @Post('moi/fiches/:annee/:semestre/commentaires/envoi')
  @HttpCode(204)
  async envoyerCommentaires(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
  ) {
    await this.objectifs.envoyerCommentaires(req.sessionUser, p.annee, p.semestre);
  }

  @Put('equipe/:employeeId/fiches/:annee/:semestre/evaluation')
  @HttpCode(204)
  async enregistrerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param(new ZodValidationPipe(periodeParamsSchema)) p: Periode,
    @Body(new ZodValidationPipe(evaluationN1Schema)) body: EvaluationN1Input,
  ) {
    await this.objectifs.enregistrerEvaluation(
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

  /** Les dates d'évaluation : la page « Évaluation des objectifs » de la DCH. */
  @Get('evaluations/dates')
  @Peut('pilotage')
  datesEvaluation(@Req() req: AuthenticatedRequest) {
    return this.objectifs.datesEvaluation(req.sessionUser);
  }

  @Put('evaluations/dates')
  @Peut('pilotage')
  fixerDatesEvaluation(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(datesEvaluationSchema)) body: DatesEvaluationInput,
  ) {
    return this.objectifs.fixerDatesEvaluation(req.sessionUser, body);
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
