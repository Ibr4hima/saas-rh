import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  anneeDeGrilleSchema,
  anneeDEvaluationSchema,
  choisirLePersonnelSchema,
  commenterGrilleSchema,
  enregistrerGrilleSchema,
  periodeEvaluationSchema,
  renvoyerGrilleSchema,
  validerGrilleSchema,
  type AnneeDEvaluation,
  type ChoisirLePersonnelInput,
  type CommenterGrilleInput,
  type EnregistrerGrilleInput,
  type PeriodeEvaluationInput,
  type RenvoyerGrilleInput,
  type ValiderGrilleInput,
} from '@teranga/contracts';
import { contentDisposition } from '../../common/telechargement';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, FermeAuxInactifs } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { EvaluationsService } from './evaluations.service';

/** L'année dans l'adresse d'une grille ou d'une période. */
const ANNEE = new ZodValidationPipe(anneeDeGrilleSchema);

/**
 * L'évaluation annuelle sur la grille de l'APIX (ADR-0149) : ouverte à tout
 * agent, bornée par l'organigramme. Le service ne laisse faire à chacun que
 * ce que sa place dans le circuit de la grille permet.
 */
@Controller('evaluations')
@UseGuards(SessionGuard, AccesGuard)
@FermeAuxInactifs()
export class EvaluationsController {
  constructor(@Inject(EvaluationsService) private readonly evaluations: EvaluationsService) {}

  @Get('periode')
  periode(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(anneeDEvaluationSchema)) q: AnneeDEvaluation,
  ) {
    return this.evaluations.periode(req.sessionUser, q.annee);
  }

  @Put('periode/:annee')
  fixerPeriode(
    @Req() req: AuthenticatedRequest,
    @Param('annee', ANNEE) annee: number,
    @Body(new ZodValidationPipe(periodeEvaluationSchema)) body: PeriodeEvaluationInput,
  ) {
    return this.evaluations.fixerPeriode(req.sessionUser, annee, body);
  }

  @Get('equipe')
  equipe(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(anneeDEvaluationSchema)) q: AnneeDEvaluation,
  ) {
    return this.evaluations.equipe(req.sessionUser, q.annee);
  }

  @Get('suivi')
  suivi(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(anneeDEvaluationSchema)) q: AnneeDEvaluation,
  ) {
    return this.evaluations.suivi(req.sessionUser, q.annee);
  }

  /** Cadre ou non cadre, depuis le suivi, son propre dossier compris (ADR-0157). */
  @Put('personnel/:employeeId')
  @HttpCode(204)
  async choisirLePersonnel(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(choisirLePersonnelSchema)) body: ChoisirLePersonnelInput,
  ) {
    await this.evaluations.choisirLePersonnel(req.sessionUser, employeeId, body.personnel);
  }

  @Get('moi')
  mesEvaluations(@Req() req: AuthenticatedRequest) {
    return this.evaluations.mesEvaluations(req.sessionUser);
  }

  @Get('dossiers/:employeeId')
  dossier(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.evaluations.dossier(req.sessionUser, employeeId);
  }

  @Get('grilles/:employeeId/:annee')
  grille(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
  ) {
    return this.evaluations.grille(req.sessionUser, employeeId, annee);
  }

  @Put('grilles/:employeeId/:annee')
  enregistrer(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
    @Body(new ZodValidationPipe(enregistrerGrilleSchema)) body: EnregistrerGrilleInput,
  ) {
    return this.evaluations.enregistrer(req.sessionUser, employeeId, annee, body.contenu);
  }

  @Post('grilles/:employeeId/:annee/envoi')
  @HttpCode(200)
  envoyer(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
  ) {
    return this.evaluations.envoyer(req.sessionUser, employeeId, annee);
  }

  @Post('grilles/:employeeId/:annee/reprise')
  @HttpCode(200)
  reprendre(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
  ) {
    return this.evaluations.reprendre(req.sessionUser, employeeId, annee);
  }

  @Post('grilles/:employeeId/:annee/renvoi')
  @HttpCode(200)
  renvoyer(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
    @Body(new ZodValidationPipe(renvoyerGrilleSchema)) body: RenvoyerGrilleInput,
  ) {
    return this.evaluations.renvoyer(req.sessionUser, employeeId, annee, body.mot);
  }

  @Post('grilles/:employeeId/:annee/validation')
  @HttpCode(200)
  valider(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
    @Body(new ZodValidationPipe(validerGrilleSchema)) body: ValiderGrilleInput,
  ) {
    return this.evaluations.valider(req.sessionUser, employeeId, annee, body.commentaires);
  }

  @Post('grilles/:employeeId/:annee/n2')
  @HttpCode(200)
  transmettre(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
  ) {
    return this.evaluations.transmettre(req.sessionUser, employeeId, annee);
  }

  @Post('grilles/:employeeId/:annee/reprise-n2')
  @HttpCode(200)
  reprendreAuN2(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
  ) {
    return this.evaluations.reprendreAuN2(req.sessionUser, employeeId, annee);
  }

  @Post('grilles/:employeeId/:annee/dch')
  @HttpCode(200)
  terminer(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
  ) {
    return this.evaluations.terminer(req.sessionUser, employeeId, annee);
  }

  @Post('grilles/:employeeId/:annee/commentaires-n2')
  @HttpCode(200)
  commenter(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
    @Body(new ZodValidationPipe(commenterGrilleSchema)) body: CommenterGrilleInput,
  ) {
    return this.evaluations.commenter(req.sessionUser, employeeId, annee, body.commentaires);
  }

  /** Le PDF de la grille ; « inline » l'ouvre dans la visionneuse du navigateur. */
  @Get('grilles/:employeeId/:annee/pdf')
  async pdf(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Param('annee', ANNEE) annee: number,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.evaluations.pdf(req.sessionUser, employeeId, annee);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      contentDisposition(disposition === 'inline' ? 'inline' : 'attachment', filename),
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }
}
