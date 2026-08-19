import {
  Body,
  Controller,
  Delete,
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
  createAbsenceRequestSchema,
  createAbsenceTypeSchema,
  createHolidaySchema,
  decideAbsenceRequestSchema,
  listAbsenceRequestsQuerySchema,
  previewAbsenceSchema,
  setBalanceSchema,
  updateApprovalChainSchema,
  type CreateAbsenceRequestInput,
  type CreateAbsenceTypeInput,
  type CreateHolidayInput,
  type DecideAbsenceRequestInput,
  type ListAbsenceRequestsQuery,
  type SetBalanceInput,
  type UpdateApprovalChainInput,
} from '@teranga/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AbsencesService } from './absences.service';

const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
});

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class AbsencesController {
  constructor(@Inject(AbsencesService) private readonly absences: AbsencesService) {}

  // ---------- Types ----------

  @Get('absence-types')
  listTypes(@Req() req: AuthenticatedRequest) {
    return this.absences.listTypes(req.sessionUser);
  }

  @Post('absence-types')
  @Roles('admin', 'hr')
  createType(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createAbsenceTypeSchema)) body: CreateAbsenceTypeInput,
  ) {
    return this.absences.createType(req.sessionUser, body);
  }

  // ---------- Jours fériés ----------

  @Get('holidays')
  listHolidays(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(yearQuerySchema)) query: { year: number },
  ) {
    return this.absences.listHolidays(req.sessionUser, query.year);
  }

  @Post('holidays')
  @Roles('admin', 'hr')
  createHoliday(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createHolidaySchema)) body: CreateHolidayInput,
  ) {
    return this.absences.createHoliday(req.sessionUser, body);
  }

  @Delete('holidays/:id')
  @Roles('admin', 'hr')
  @HttpCode(204)
  async deleteHoliday(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.absences.deleteHoliday(req.sessionUser, id);
  }

  // ---------- Circuit d'approbation ----------

  @Get('approval-chain')
  getChain(@Req() req: AuthenticatedRequest) {
    return this.absences.getChain(req.sessionUser);
  }

  @Put('approval-chain')
  @Roles('admin')
  updateChain(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(updateApprovalChainSchema)) body: UpdateApprovalChainInput,
  ) {
    return this.absences.updateChain(req.sessionUser, body.levels);
  }

  // ---------- Soldes ----------

  @Get('employees/:id/balances')
  balances(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(yearQuerySchema)) query: { year: number },
  ) {
    return this.absences.balances(req.sessionUser, id, query.year);
  }

  @Put('balances')
  @Roles('admin', 'hr')
  @HttpCode(204)
  async setBalance(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(setBalanceSchema)) body: SetBalanceInput,
  ) {
    await this.absences.setBalance(req.sessionUser, body);
  }

  // ---------- Demandes ----------

  @Post('absence-preview')
  preview(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(previewAbsenceSchema)) body: { startDate: string; endDate: string },
  ) {
    return this.absences.preview(req.sessionUser, body.startDate, body.endDate);
  }

  @Get('absence-requests')
  listRequests(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listAbsenceRequestsQuerySchema)) query: ListAbsenceRequestsQuery,
  ) {
    return this.absences.listRequests(req.sessionUser, query);
  }

  @Get('absences/upcoming')
  upcoming(@Req() req: AuthenticatedRequest) {
    return this.absences.upcoming(req.sessionUser);
  }

  @Post('absence-requests')
  createRequest(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createAbsenceRequestSchema)) body: CreateAbsenceRequestInput,
  ) {
    return this.absences.createRequest(req.sessionUser, body);
  }

  @Post('absence-requests/:id/decision')
  @HttpCode(204)
  async decide(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideAbsenceRequestSchema)) body: DecideAbsenceRequestInput,
  ) {
    await this.absences.decide(req.sessionUser, id, body);
  }

  @Post('absence-requests/:id/cancel')
  @HttpCode(204)
  async cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.absences.cancel(req.sessionUser, id);
  }

  /** Justificatif PDF joint à une demande (RH ou titulaire uniquement). */
  @Get('absence-requests/:id/document')
  async document(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const doc = await this.absences.document(req.sessionUser, id);
    res.setHeader('Content-Type', doc.contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.end(doc.data);
  }
}
