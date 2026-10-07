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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  applySchema,
  createJobPostingSchema,
  deleteJobPostingsSchema,
  updateApplicationSchema,
  updateJobPostingSchema,
  type ApplyInput,
  type CreateJobPostingInput,
  type DeleteJobPostingsInput,
  type UpdateApplicationInput,
  type UpdateJobPostingInput,
} from '@teranga/contracts';
import { problem } from '../../common/problem';

import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, Peut } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ApplyService } from './apply.service';
import { JobsService } from './jobs.service';
import { contentDisposition } from '../../common/telechargement';

const SLUG_RE = /^[A-Za-z0-9_-]{10,64}$/;

/**
 * Face interne : les offres et les dossiers. Deux délégations distinctes —
 * qui rédige les offres ne lit pas forcément les candidatures ; les unes et
 * les autres voient la liste des offres, par où l'on entre.
 */
@Controller()
@UseGuards(SessionGuard, AccesGuard)
@Peut('recrutement.offres', 'recrutement.candidatures')
export class RecruitmentController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Post('jobs')
  @Peut('recrutement.offres')
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createJobPostingSchema)) body: CreateJobPostingInput,
  ) {
    return this.jobs.create(req.sessionUser, body);
  }

  @Get('jobs')
  list(@Req() req: AuthenticatedRequest) {
    return this.jobs.list(req.sessionUser);
  }

  @Get('jobs/:id')
  detail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.detail(req.sessionUser, id);
  }

  @Patch('jobs/:id')
  @Peut('recrutement.offres')
  @HttpCode(204)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateJobPostingSchema)) body: UpdateJobPostingInput,
  ) {
    await this.jobs.update(req.sessionUser, id, body);
  }

  /**
   * Suppression d'offres — toujours par lot, même pour une seule. Une route
   * unitaire à côté ferait deux chemins à garder d'accord pour un seul geste.
   */
  @Post('jobs/delete')
  @Peut('recrutement.offres')
  remove(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(deleteJobPostingsSchema)) body: DeleteJobPostingsInput,
  ) {
    return this.jobs.remove(req.sessionUser, body);
  }

  @Get('jobs/:id/applications')
  @Peut('recrutement.candidatures')
  applications(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.applications(req.sessionUser, id);
  }

  /** Les candidatures rejetées, toutes offres confondues. */
  @Get('applications/rejected')
  @Peut('recrutement.candidatures')
  rejetees(@Req() req: AuthenticatedRequest) {
    return this.jobs.rejetees(req.sessionUser);
  }

  /** Leur nombre, pour l'entrée du menu : sans rien déchiffrer ni tracer. */
  @Get('applications/rejected/count')
  @Peut('recrutement.candidatures')
  nombreDeRejetees(@Req() req: AuthenticatedRequest) {
    return this.jobs.nombreDeRejetees(req.sessionUser);
  }

  @Patch('applications/:id')
  @Peut('recrutement.candidatures')
  @HttpCode(204)
  async updateApplication(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateApplicationSchema)) body: UpdateApplicationInput,
  ) {
    await this.jobs.updateStage(req.sessionUser, id, body.stage);
  }

  @Delete('applications/:id')
  @Peut('recrutement.candidatures')
  @HttpCode(204)
  async deleteApplication(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.jobs.deleteApplication(req.sessionUser, id);
  }

  @Get('application-documents/:id')
  @Peut('recrutement.candidatures')
  async document(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const doc = await this.jobs.document(req.sessionUser, id);
    res.setHeader('Content-Type', doc.contentType);
    // filename* encodé : les noms de fichiers viennent du public. La pièce
    // se télécharge, elle ne s'ouvre pas dans l'onglet de l'application ; ni
    // le navigateur ni un intermédiaire n'en gardent de copie, et elle ne
    // s'exécute pas, quoi qu'elle contienne (le lecteur la lit en mémoire).
    res.setHeader('Content-Disposition', contentDisposition('attachment', doc.filename));
    res.setHeader('Cache-Control', 'no-store, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end(doc.data);
  }
}

/** Face publique : la page de candidature (aucune session). */
@Controller()
export class PublicJobsController {
  constructor(@Inject(ApplyService) private readonly applications: ApplyService) {}

  @Get('public/jobs/:slug')
  info(@Param('slug') slug: string) {
    if (!SLUG_RE.test(slug)) return { valid: false as const, reason: 'not_found' as const };
    return this.applications.info(slug);
  }

  @Post('public/jobs/:slug/apply')
  @HttpCode(201)
  async apply(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(applySchema)) body: ApplyInput,
  ) {
    if (!SLUG_RE.test(slug)) {
      problem(410, 'recruitment.job_unavailable', "Cette offre n'accepte plus de candidatures");
    }
    await this.applications.apply(slug, body);
    return { ok: true };
  }
}
