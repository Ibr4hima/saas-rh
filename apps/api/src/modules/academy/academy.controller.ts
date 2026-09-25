import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type {
  BeatInput,
  MoveInput,
  PrepareVideoInput,
  QuestionInput,
  QuizSettingsInput,
  SaveCourseInput,
  SubmitAttemptInput,
  SubmitTrialInput,
  TitleInput,
} from '@teranga/contracts';
import {
  beatSchema,
  moveSchema,
  prepareVideoSchema,
  publishCourseSchema,
  questionSchema,
  quizSettingsSchema,
  saveCourseSchema,
  specimenQuerySchema,
  submitAttemptSchema,
  submitTrialSchema,
  supportQuerySchema,
  titleSchema,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AcademyEvaluationService } from './academy-evaluation.service';
import { AcademyService } from './academy.service';

/**
 * APIX Academy.
 *
 * Le catalogue et la lecture sont ouverts à TOUT membre du tenant : c'est
 * l'objet même du module. La construction du catalogue — formations,
 * modules, leçons, vidéos, supports — est réservée à la RH.
 */
@Controller('academy')
@UseGuards(SessionGuard, RolesGuard)
export class AcademyController {
  constructor(
    @Inject(AcademyService) private readonly academy: AcademyService,
    @Inject(AcademyEvaluationService) private readonly evaluation: AcademyEvaluationService,
  ) {}

  // ———————————— catalogue et lecture

  @Get('courses')
  catalogue(@Req() req: AuthenticatedRequest) {
    return this.academy.catalogue(req.sessionUser);
  }

  @Get('courses/:id')
  detail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.detail(req.sessionUser, id);
  }

  @Post('lessons/:id/lecture')
  demarrer(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.demarrer(req.sessionUser, id);
  }

  @Post('lessons/:id/battement')
  battement(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(beatSchema)) body: BeatInput,
  ) {
    return this.academy.battement(req.sessionUser, id, body);
  }

  @Get('lessons/:id/support')
  async support(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, data } = await this.academy.support(req.sessionUser, id);
    res.setHeader('Content-Type', 'application/pdf');
    // Le nom en deux formes : une version ASCII pour les vieux navigateurs, et
    // la vraie, en UTF-8 (RFC 6266) — sans elle, « Le PIB et ses trois
    // optiques.pdf » arrivait sous le nom « Le%20PIB%20et%20ses… ».
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
    res.setHeader(
      'Content-Disposition',
      `${disposition === 'inline' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(data);
  }

  // ———————————— gestion du catalogue (RH)

  @Get('gestion/courses')
  @Roles('admin', 'hr')
  gestionListe(@Req() req: AuthenticatedRequest) {
    return this.academy.gestionListe(req.sessionUser);
  }

  @Get('gestion/courses/:id')
  @Roles('admin', 'hr')
  gestionDetail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.gestionDetail(req.sessionUser, id);
  }

  @Post('courses')
  @Roles('admin', 'hr')
  creerFormation(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(saveCourseSchema)) body: SaveCourseInput,
  ) {
    return this.academy.creerFormation(req.sessionUser, body);
  }

  @Put('courses/:id')
  @Roles('admin', 'hr')
  modifierFormation(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(saveCourseSchema)) body: SaveCourseInput,
  ) {
    return this.academy.modifierFormation(req.sessionUser, id, body);
  }

  @Delete('courses/:id')
  @Roles('admin', 'hr')
  supprimerFormation(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.supprimerFormation(req.sessionUser, id);
  }

  @Post('courses/:id/publication')
  @Roles('admin', 'hr')
  publier(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(publishCourseSchema)) body: { published: boolean },
  ) {
    return this.academy.publier(req.sessionUser, id, body.published);
  }

  @Post('courses/:id/modules')
  @Roles('admin', 'hr')
  creerModule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(titleSchema)) body: TitleInput,
  ) {
    return this.academy.creerModule(req.sessionUser, id, body.title);
  }

  @Patch('modules/:id')
  @Roles('admin', 'hr')
  renommerModule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(titleSchema)) body: TitleInput,
  ) {
    return this.academy.renommerModule(req.sessionUser, id, body.title);
  }

  @Delete('modules/:id')
  @Roles('admin', 'hr')
  supprimerModule(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.supprimerModule(req.sessionUser, id);
  }

  @Post('modules/:id/deplacer')
  @Roles('admin', 'hr')
  deplacerModule(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(moveSchema)) body: MoveInput,
  ) {
    return this.academy.deplacerModule(req.sessionUser, id, body.sens);
  }

  @Post('modules/:id/lessons')
  @Roles('admin', 'hr')
  creerLecon(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(titleSchema)) body: TitleInput,
  ) {
    return this.academy.creerLecon(req.sessionUser, id, body.title);
  }

  @Patch('lessons/:id')
  @Roles('admin', 'hr')
  renommerLecon(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(titleSchema)) body: TitleInput,
  ) {
    return this.academy.renommerLecon(req.sessionUser, id, body.title);
  }

  @Delete('lessons/:id')
  @Roles('admin', 'hr')
  supprimerLecon(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.supprimerLecon(req.sessionUser, id);
  }

  @Post('lessons/:id/deplacer')
  @Roles('admin', 'hr')
  deplacerLecon(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(moveSchema)) body: MoveInput,
  ) {
    return this.academy.deplacerLecon(req.sessionUser, id, body.sens);
  }

  /** Préparer l'envoi : où l'écran doit envoyer le fichier. */
  @Post('lessons/:id/video')
  @Roles('admin', 'hr')
  preparerVideo(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(prepareVideoSchema)) body: PrepareVideoInput,
  ) {
    return this.academy.preparerVideo(req.sessionUser, id, body);
  }

  /**
   * Le fichier vidéo, en FLUX (stockage local seulement).
   *
   * Aucun analyseur de corps ne touche cette route : le fichier descend de la
   * requête au disque par morceaux, sans jamais être entier en mémoire.
   */
  @Put('lessons/:id/video/fichier')
  @Roles('admin', 'hr')
  recevoirVideo(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.recevoirVideo(req.sessionUser, id, req);
  }

  /** Le support PDF arrive en binaire brut, le nom dans l'URL (cf. textes de référence). */
  @Post('lessons/:id/support')
  @Roles('admin', 'hr')
  deposerSupport(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(supportQuerySchema)) query: { filename: string },
  ) {
    const octets = req.body as unknown;
    if (!Buffer.isBuffer(octets)) {
      problem(415, 'academy.bad_body', 'Le support doit être envoyé en application/pdf');
    }
    return this.academy.deposerSupport(req.sessionUser, id, query.filename, octets);
  }

  @Delete('lessons/:id/support')
  @Roles('admin', 'hr')
  supprimerSupport(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.academy.supprimerSupport(req.sessionUser, id);
  }

  // ———————————— l'évaluation finale : la banque (RH)

  @Put('courses/:id/evaluation')
  @Roles('admin', 'hr')
  reglerEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(quizSettingsSchema)) body: QuizSettingsInput,
  ) {
    return this.evaluation.reglerEvaluation(req.sessionUser, id, body);
  }

  @Post('courses/:id/questions')
  @Roles('admin', 'hr')
  creerQuestion(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionSchema)) body: QuestionInput,
  ) {
    return this.evaluation.creerQuestion(req.sessionUser, id, body);
  }

  @Put('questions/:id')
  @Roles('admin', 'hr')
  modifierQuestion(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(questionSchema)) body: QuestionInput,
  ) {
    return this.evaluation.modifierQuestion(req.sessionUser, id, body);
  }

  @Delete('questions/:id')
  @Roles('admin', 'hr')
  supprimerQuestion(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluation.supprimerQuestion(req.sessionUser, id);
  }

  @Post('questions/:id/deplacer')
  @Roles('admin', 'hr')
  deplacerQuestion(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(moveSchema)) body: MoveInput,
  ) {
    return this.evaluation.deplacerQuestion(req.sessionUser, id, body.sens);
  }

  // ———————————— l'évaluation finale : l'essai (RH) — rien n'est enregistré

  @Post('courses/:id/essai')
  @Roles('admin', 'hr')
  essayer(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluation.essayer(req.sessionUser, id);
  }

  @Post('courses/:id/essai/correction')
  @Roles('admin', 'hr')
  corrigerEssai(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(submitTrialSchema)) body: SubmitTrialInput,
  ) {
    return this.evaluation.corrigerEssai(req.sessionUser, id, body);
  }

  @Get('courses/:id/certificat-specimen')
  @Roles('admin', 'hr')
  async certificatSpecimen(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('score') score: string | undefined,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const q = specimenQuerySchema.safeParse({ score });
    if (!q.success) problem(400, 'academy.invalid_score', 'Score invalide');
    const { filename, data } = await this.evaluation.specimen(req.sessionUser, id, q.data.score);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition === 'inline' ? 'inline' : 'attachment'}; filename="${filename}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(data);
  }

  // ———————————— l'évaluation finale : la copie (agent)

  @Post('courses/:id/tentatives')
  demarrerTentative(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluation.demarrer(req.sessionUser, id);
  }

  @Post('tentatives/:id/soumission')
  soumettre(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(submitAttemptSchema)) body: SubmitAttemptInput,
  ) {
    return this.evaluation.soumettre(req.sessionUser, id, body);
  }

  // ———————————— les certificats

  @Get('certificats')
  mesCertificats(@Req() req: AuthenticatedRequest) {
    return this.evaluation.mesCertificats(req.sessionUser);
  }

  @Get('employees/:id/certificats')
  certificatsDe(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.evaluation.certificatsDe(req.sessionUser, id);
  }

  @Get('certificats/:id/pdf')
  async certificatPdf(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, data } = await this.evaluation.pdf(req.sessionUser, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition === 'inline' ? 'inline' : 'attachment'}; filename="${filename}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(data);
  }
}

/**
 * La vérification PUBLIQUE d'un certificat — sans compte.
 *
 * C'est la page que le QR code ouvre : un recruteur, un partenaire, une autre
 * administration y confirme qu'un certificat présenté est authentique. Elle
 * ne rend que ce que le certificat imprimé dit déjà : le titulaire, la
 * formation, le score, les dates et le statut du jour.
 */
@Controller('public/certificats')
export class PublicCertificatsController {
  constructor(
    @Inject(AcademyEvaluationService) private readonly evaluation: AcademyEvaluationService,
  ) {}

  @Get(':numero')
  verifier(@Param('numero') numero: string) {
    return this.evaluation.verifier(numero.slice(0, 40));
  }
}

/**
 * Les vidéos du stockage LOCAL.
 *
 * Pas de session ici : l'élément `<video>` du navigateur demande le fichier
 * par morceaux, des dizaines de fois par leçon, et chaque demande irait
 * sinon chercher la session en base. L'adresse porte à la place une
 * SIGNATURE et une DATE D'EXPIRATION, délivrées au démarrage de la leçon —
 * après que le service a vérifié que l'agent y avait droit. C'est ainsi que
 * Cloudflare Stream sert ses vidéos, et c'est voulu : le passage au
 * fournisseur cible ne changera pas la forme de l'échange.
 */
@Controller('academy/media')
export class AcademyMediaController {
  constructor(@Inject(AcademyService) private readonly academy: AcademyService) {}

  @Get(':tenantId/:uid')
  async media(
    @Param('tenantId') tenantId: string,
    @Param('uid') uid: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const chemin = this.academy.media(tenantId, uid, exp ?? '', sig ?? '');
    let taille: number;
    try {
      taille = (await stat(chemin)).size;
    } catch {
      problem(404, 'academy.media_not_found', 'Vidéo introuvable');
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    // Le lecteur demande la vidéo PAR MORCEAUX (`Range`) : c'est ce qui lui
    // permet de démarrer avant d'avoir tout reçu, et de reprendre au milieu.
    const plage = req.headers.range;
    let debut = 0;
    let fin = taille - 1;
    if (plage) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(plage);
      if (m && m[1] === '' && m[2] !== '') {
        debut = Math.max(0, taille - Number(m[2]));
      } else if (m && m[1] !== '') {
        debut = Number(m[1]);
        if (m[2] !== '') fin = Math.min(Number(m[2]), taille - 1);
      }
      if (!m || debut > fin || debut >= taille) {
        res.status(416).setHeader('Content-Range', `bytes */${taille}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${debut}-${fin}/${taille}`);
    } else {
      res.status(200);
    }
    res.setHeader('Content-Length', String(fin - debut + 1));
    // Un lecteur qui abandonne sa demande (on avance dans la vidéo) coupe la
    // connexion : ce n'est pas une erreur, seulement une fin anticipée.
    await pipeline(createReadStream(chemin, { start: debut, end: fin }), res).catch(
      () => undefined,
    );
  }
}
