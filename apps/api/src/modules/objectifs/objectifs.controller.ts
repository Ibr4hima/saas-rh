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
  anneeParamsSchema,
  anneeQuerySchema,
  statutObjectifSchema,
  type StatutObjectifInput,
  commentairesAgentSchema,
  type CommentairesAgentInput,
  creerObjectifSchema,
  dateEvaluationSchema,
  type DateEvaluationInput,
  enregistrerFicheObjectifsSchema,
  type EnregistrerFicheObjectifsInput,
  evaluationN1Schema,
  type EvaluationN1Input,
  evaluerObjectifSchema,
  modifierObjectifSchema,
  type CreerObjectifInput,
  type EvaluerObjectifInput,
  type ModifierObjectifInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, FermeAuxInactifs, Peut } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ObjectifsService } from './objectifs.service';

/** L'année d'une fiche, lue dans l'adresse. */
interface Annee {
  annee: number;
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

  @Put('equipe/:employeeId/fiche')
  enregistrerFiche(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(enregistrerFicheObjectifsSchema))
    body: EnregistrerFicheObjectifsInput,
  ) {
    return this.objectifs.enregistrerFiche(req.sessionUser, employeeId, body);
  }

  // L'année : ce que l'agent en fait, ce que le n+1 en dit.

  @Put('moi/fiches/:annee/statuts')
  statuer(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(anneeParamsSchema)) p: Annee,
    @Body(new ZodValidationPipe(statutObjectifSchema)) body: StatutObjectifInput,
  ) {
    return this.objectifs.statuer(req.sessionUser, p.annee, body);
  }

  @Put('moi/fiches/:annee/commentaires')
  @HttpCode(204)
  async enregistrerCommentaires(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(anneeParamsSchema)) p: Annee,
    @Body(new ZodValidationPipe(commentairesAgentSchema)) body: CommentairesAgentInput,
  ) {
    await this.objectifs.enregistrerCommentaires(req.sessionUser, p.annee, body);
  }

  @Post('moi/fiches/:annee/commentaires/envoi')
  @HttpCode(204)
  async envoyerCommentaires(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(anneeParamsSchema)) p: Annee,
  ) {
    await this.objectifs.envoyerCommentaires(req.sessionUser, p.annee);
  }

  @Put('equipe/:employeeId/fiches/:annee/evaluation')
  @HttpCode(204)
  async enregistrerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param(new ZodValidationPipe(anneeParamsSchema)) p: Annee,
    @Body(new ZodValidationPipe(evaluationN1Schema)) body: EvaluationN1Input,
  ) {
    await this.objectifs.enregistrerEvaluation(req.sessionUser, employeeId, p.annee, body);
  }

  @Post('equipe/:employeeId/fiches/:annee/evaluation/validation')
  @HttpCode(204)
  async validerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param(new ZodValidationPipe(anneeParamsSchema)) p: Annee,
  ) {
    await this.objectifs.validerEvaluation(req.sessionUser, employeeId, p.annee);
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

  /** La date de l'évaluation annuelle : la page « Évaluation des objectifs » de la DCH. */
  @Get('evaluations/date')
  @Peut('pilotage')
  dateEvaluation(@Req() req: AuthenticatedRequest) {
    return this.objectifs.dateEvaluation(req.sessionUser);
  }

  @Put('evaluations/date')
  @Peut('pilotage')
  fixerDateEvaluation(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(dateEvaluationSchema)) body: DateEvaluationInput,
  ) {
    return this.objectifs.fixerDateEvaluation(req.sessionUser, body);
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
