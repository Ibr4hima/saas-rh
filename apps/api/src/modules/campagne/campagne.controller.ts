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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  choixDeLEvaluateurSchema,
  datesDeLaCampagneSchema,
  datesDesObjectifsSchema,
  ecritureDeLAutoSchema,
  ecritureDeLEvaluationSchema,
  ecritureDesCommentairesSchema,
  ecritureDesObjectifsSchema,
  transmissionDeLEvaluationSchema,
  type ChoixDeLEvaluateur,
  type DatesDeLaCampagne,
  type DatesDesObjectifs,
  type EcritureDeLAuto,
  type EcritureDeLEvaluation,
  type EcritureDesCommentaires,
  type EcritureDesObjectifs,
  type TransmissionDeLEvaluation,
} from '@teranga/contracts';
import { contentDisposition } from '../../common/telechargement';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, FermeAuxInactifs } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CampagneService } from './campagne.service';

/**
 * La campagne d'évaluation annuelle (ADR-0211, ADR-0215 à ADR-0218,
 * ADR-0221) : ouverte à tout agent. On n'y lit que sa propre fiche, celles
 * des agents qu'on évalue et celles des équipes de ses N+1 ; on n'y écrit
 * que sa propre auto-évaluation, l'évaluation des agents qu'on évalue et
 * leur transmission à la DCH, la validation de sa propre évaluation, et ses
 * commentaires de N+2. Le suivi de la DCH et les fiches qui lui sont
 * transmises demandent l'habilitation « Tableau de bord » ; les dates de
 * l'évaluation et le choix des évaluateurs, un compte d'administration
 * (ADR-0222). Les objectifs de l'année, une fois leur fixation ouverte,
 * s'écrivent par le N+1 de l'organigramme seulement (ADR-0274).
 */
@Controller('campagne')
@UseGuards(SessionGuard, AccesGuard)
@FermeAuxInactifs()
export class CampagneController {
  constructor(@Inject(CampagneService) private readonly campagne: CampagneService) {}

  /** L'accueil : la fiche de la personne connectée, son auto-évaluation, son équipe. */
  @Get()
  accueil(@Req() req: AuthenticatedRequest) {
    return this.campagne.accueil(req.sessionUser);
  }

  /** Un agent de l'équipe : la page ne s'ouvre qu'à son évaluateur. */
  @Get('equipe/:employeeId')
  agent(@Req() req: AuthenticatedRequest, @Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.campagne.agentDeLEquipe(req.sessionUser, employeeId);
  }

  /** Le brouillon de l'évaluation d'un agent de son équipe. */
  @Put('equipe/:employeeId/evaluation')
  enregistrerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(ecritureDeLEvaluationSchema)) body: EcritureDeLEvaluation,
  ) {
    return this.campagne.enregistrerEvaluation(req.sessionUser, employeeId, body);
  }

  /** L'évaluation, complète, transmise à l'agent, et au N+2 si le N+1 le choisit (ADR-0278). */
  @Post('equipe/:employeeId/evaluation/transmission')
  @HttpCode(200)
  transmettreEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(transmissionDeLEvaluationSchema)) body: TransmissionDeLEvaluation,
  ) {
    return this.campagne.transmettreEvaluation(req.sessionUser, employeeId, body);
  }

  /**
   * La fiche de l'agent, en PDF, telle que l'évaluation en cours la remplit :
   * ce que « Valider » affiche (ADR-0260). En POST, comme l'aperçu de
   * l'auto-évaluation : les réponses restent hors de l'adresse.
   */
  @Post('equipe/:employeeId/apercu')
  async apercuDeLEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(ecritureDeLEvaluationSchema)) body: EcritureDeLEvaluation,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.campagne.apercuDeLEvaluation(
      req.sessionUser,
      employeeId,
      body,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition('inline', filename));
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }

  /** La fiche, transmise à la DCH par le N+1 : elle ne change plus. */
  @Post('equipe/:employeeId/dch')
  @HttpCode(200)
  transmettreALaDCH(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.campagne.transmettreALaDCH(req.sessionUser, employeeId);
  }

  /** La fiche, reprise par le N+1 au N+2 qui ne l'a pas commentée : c'est définitif (ADR-0278). */
  @Post('equipe/:employeeId/reprise-n2')
  @HttpCode(200)
  reprendreAuN2(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.campagne.reprendreAuN2(req.sessionUser, employeeId);
  }

  /**
   * Les objectifs d'un agent de son équipe dans l'organigramme : la page ne
   * s'ouvre qu'à son N+1, une fois leur fixation ouverte (ADR-0274).
   */
  @Get('objectifs/equipe/:employeeId')
  objectifsDeLAgent(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.campagne.objectifsDeLAgent(req.sessionUser, employeeId);
  }

  /** Le brouillon de ses objectifs. */
  @Put('objectifs/equipe/:employeeId')
  enregistrerLesObjectifs(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(ecritureDesObjectifsSchema)) body: EcritureDesObjectifs,
  ) {
    return this.campagne.enregistrerLesObjectifs(req.sessionUser, employeeId, body.objectifs);
  }

  /** Ses objectifs, complets, transmis à l'agent. */
  @Post('objectifs/equipe/:employeeId/transmission')
  @HttpCode(200)
  transmettreLesObjectifs(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(ecritureDesObjectifsSchema)) body: EcritureDesObjectifs,
  ) {
    return this.campagne.transmettreLesObjectifs(req.sessionUser, employeeId, body.objectifs);
  }

  /** L'administration de la campagne : les dates, et qui évalue qui (ADR-0222). */
  @Get('administration')
  administration(@Req() req: AuthenticatedRequest) {
    return this.campagne.administration(req.sessionUser);
  }

  /** Les dates de l'évaluation : le début, la fin de l'auto-évaluation, la fin. */
  @Put('administration/dates')
  fixerLesDates(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(datesDeLaCampagneSchema)) body: DatesDeLaCampagne,
  ) {
    return this.campagne.fixerLesDates(req.sessionUser, body);
  }

  /** Les dates de la fixation des objectifs de l'année suivante (ADR-0274). */
  @Put('administration/dates-des-objectifs')
  fixerLesDatesDesObjectifs(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(datesDesObjectifsSchema)) body: DatesDesObjectifs,
  ) {
    return this.campagne.fixerLesDatesDesObjectifs(req.sessionUser, body);
  }

  /** L'évaluateur d'un agent pour la campagne ; `null` : le N+1 de l'organigramme. */
  @Put('administration/evaluateurs/:employeeId')
  choisirLEvaluateur(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(choixDeLEvaluateurSchema)) body: ChoixDeLEvaluateur,
  ) {
    return this.campagne.choisirLEvaluateur(req.sessionUser, employeeId, body.evaluateurEmployeeId);
  }

  /** La fiche de l'année d'un agent, remise à zéro par l'administration (ADR-0271). */
  @Post('administration/fiches/:employeeId/remise-a-zero')
  @HttpCode(200)
  remettreAZero(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.campagne.remettreAZero(req.sessionUser, employeeId);
  }

  /** Le suivi de la DCH : chaque agent à évaluer cette année, et où en est sa fiche. */
  @Get('dch')
  suiviDeLaDCH(@Req() req: AuthenticatedRequest) {
    return this.campagne.suiviDeLaDCH(req.sessionUser);
  }

  /** La fiche d'un agent, une fois transmise à la DCH, en entier. */
  @Get('dch/:employeeId')
  ficheDeLaDCH(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.campagne.ficheDeLaDCH(req.sessionUser, employeeId);
  }

  /** Son PDF, la version complète, à verser au dossier de l'agent. */
  @Get('dch/:employeeId/pdf')
  async pdfDeLaDCH(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.campagne.pdfDeLaDCH(req.sessionUser, employeeId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition('attachment', filename));
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }

  /** La fiche d'un agent dont on est le N+2 : la page ne s'ouvre qu'au N+2. */
  @Get('n2/:employeeId')
  ficheDuN2(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.campagne.ficheDuN2(req.sessionUser, employeeId);
  }

  /** Le brouillon de ses commentaires de N+2. */
  @Put('n2/:employeeId/commentaires')
  enregistrerCommentaires(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(ecritureDesCommentairesSchema)) body: EcritureDesCommentaires,
  ) {
    return this.campagne.enregistrerCommentaires(req.sessionUser, employeeId, body.commentaires);
  }

  /** Ses commentaires de N+2, transmis au N+1, avec ou sans un mot. */
  @Post('n2/:employeeId/commentaires/transmission')
  @HttpCode(200)
  transmettreCommentaires(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(ecritureDesCommentairesSchema)) body: EcritureDesCommentaires,
  ) {
    return this.campagne.transmettreCommentaires(req.sessionUser, employeeId, body.commentaires);
  }

  /** Son évaluation par le N+1, une fois transmise, sans la partie réservée. */
  @Get('mon-evaluation')
  monEvaluation(@Req() req: AuthenticatedRequest) {
    return this.campagne.monEvaluation(req.sessionUser);
  }

  /** Sa validation : l'évaluation ne change plus. */
  @Post('mon-evaluation/validation')
  @HttpCode(200)
  valider(@Req() req: AuthenticatedRequest) {
    return this.campagne.validerMonEvaluation(req.sessionUser);
  }

  /**
   * Son évaluation validée, en PDF, sans la partie réservée à la hiérarchie :
   * ce qu'enregistre « Télécharger » (ADR-0268, ADR-0269).
   */
  @Get('mon-evaluation/pdf')
  async pdfDeMonEvaluation(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    const { filename, pdf } = await this.campagne.pdfDeMonEvaluation(req.sessionUser);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition('attachment', filename));
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }

  /** Son auto-évaluation, pour son formulaire. */
  @Get('auto-evaluation')
  monAuto(@Req() req: AuthenticatedRequest) {
    return this.campagne.monAuto(req.sessionUser);
  }

  /** Le brouillon de son auto-évaluation. */
  @Put('auto-evaluation')
  enregistrer(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(ecritureDeLAutoSchema)) body: EcritureDeLAuto,
  ) {
    return this.campagne.enregistrerMonAuto(req.sessionUser, body.auto);
  }

  /**
   * La partie de l'agent de sa fiche, en PDF, telle que son formulaire la
   * montre : ce que « Valider » affiche (ADR-0241). En POST, comme la
   * génération d'un document : les réponses restent hors de l'adresse.
   */
  @Post('auto-evaluation/apercu')
  async apercu(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(ecritureDeLAutoSchema)) body: EcritureDeLAuto,
    @Res() res: Response,
  ) {
    const { filename, pdf } = await this.campagne.apercuDeMonAuto(req.sessionUser, body.auto);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', contentDisposition('inline', filename));
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  }

  /** Son auto-évaluation, complète, transmise au N+1. */
  @Post('auto-evaluation/transmission')
  @HttpCode(200)
  transmettre(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(ecritureDeLAutoSchema)) body: EcritureDeLAuto,
  ) {
    return this.campagne.transmettreMonAuto(req.sessionUser, body.auto);
  }
}
