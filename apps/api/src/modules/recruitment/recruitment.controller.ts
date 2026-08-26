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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  applicationStageSchema,
  applySchema,
  createJobPostingSchema,
  updateApplicationSchema,
  updateJobPostingSchema,
  type ApplyInput,
  type CreateJobPostingInput,
  type UpdateApplicationInput,
  type UpdateJobPostingInput,
} from '@teranga/contracts';
import { problem } from '../../common/problem';

const applicationsQuerySchema = z.object({ stage: applicationStageSchema.optional() });
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ApplyService } from './apply.service';
import { JobsService } from './jobs.service';

const SLUG_RE = /^[A-Za-z0-9_-]{10,64}$/;

/** Face interne : gestion des offres et du pipeline (admin/RH). */
@Controller()
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin', 'hr')
export class RecruitmentController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Post('jobs')
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
  @HttpCode(204)
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateJobPostingSchema)) body: UpdateJobPostingInput,
  ) {
    await this.jobs.update(req.sessionUser, id, body);
  }

  /**
   * Toutes les candidatures, offres confondues. Déclarée AVANT « jobs/:id » ne
   * s'impose pas ici (le chemin diffère), mais elle reste voisine de sa sœur
   * pour qu'on ne les fasse pas diverger.
   */
  @Get('applications')
  allApplications(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(applicationsQuerySchema))
    query: z.infer<typeof applicationsQuerySchema>,
  ) {
    return this.jobs.allApplications(req.sessionUser, query);
  }

  @Get('jobs/:id/applications')
  applications(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.applications(req.sessionUser, id);
  }

  @Patch('applications/:id')
  @HttpCode(204)
  async updateApplication(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateApplicationSchema)) body: UpdateApplicationInput,
  ) {
    await this.jobs.updateStage(req.sessionUser, id, body.stage);
  }

  @Delete('applications/:id')
  @HttpCode(204)
  async deleteApplication(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.jobs.deleteApplication(req.sessionUser, id);
  }

  @Get('application-documents/:id')
  async document(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const doc = await this.jobs.document(req.sessionUser, id);
    res.setHeader('Content-Type', doc.contentType);
    // filename* encodé : les noms de fichiers viennent du public.
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
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
    @Req() req: Request,
  ) {
    if (!SLUG_RE.test(slug)) {
      problem(410, 'recruitment.job_unavailable', "Cette offre n'accepte plus de candidatures");
    }
    await this.applications.apply(slug, body, req.ip);
    return { ok: true };
  }
}
