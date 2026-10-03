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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  confierSchema,
  createAbsenceRequestSchema,
  createAbsenceTypeSchema,
  createHolidaySchema,
  decideAbsenceRequestSchema,
  listAbsenceRequestsQuerySchema,
  previewAbsenceSchema,
  setBalanceSchema,
  updateAbsenceTypeSchema,
  updateHolidaySchema,
  type ConfierInput,
  type CreateAbsenceRequestInput,
  type CreateAbsenceTypeInput,
  type CreateHolidayInput,
  type DecideAbsenceRequestInput,
  type ListAbsenceRequestsQuery,
  type SetBalanceInput,
  type UpdateAbsenceTypeInput,
  type UpdateHolidayInput,
} from '@teranga/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, FermeAuxInactifs, Peut } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { AbsencesService } from './absences.service';

const yearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()),
});

@Controller()
@UseGuards(SessionGuard, AccesGuard)
export class AbsencesController {
  constructor(@Inject(AbsencesService) private readonly absences: AbsencesService) {}

  // ---------- Types ----------

  @Get('absence-types')
  listTypes(@Req() req: AuthenticatedRequest) {
    return this.absences.listTypes(req.sessionUser);
  }

  @Post('absence-types')
  @Peut('conges.parametres')
  createType(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createAbsenceTypeSchema)) body: CreateAbsenceTypeInput,
  ) {
    return this.absences.createType(req.sessionUser, body);
  }

  @Patch('absence-types/:id')
  @Peut('conges.parametres')
  @HttpCode(204)
  async updateType(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateAbsenceTypeSchema)) body: UpdateAbsenceTypeInput,
  ) {
    await this.absences.updateType(req.sessionUser, id, body);
  }

  @Delete('absence-types/:id')
  @Peut('conges.parametres')
  @HttpCode(204)
  async deleteType(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.absences.deleteType(req.sessionUser, id);
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
  @Peut('feries')
  createHoliday(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createHolidaySchema)) body: CreateHolidayInput,
  ) {
    return this.absences.createHoliday(req.sessionUser, body);
  }

  @Patch('holidays/:id')
  @Peut('feries')
  @HttpCode(204)
  async updateHoliday(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateHolidaySchema)) body: UpdateHolidayInput,
  ) {
    await this.absences.updateHoliday(req.sessionUser, id, body);
  }

  @Delete('holidays/:id')
  @Peut('feries')
  @HttpCode(204)
  async deleteHoliday(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.absences.deleteHoliday(req.sessionUser, id);
  }

  // ---------- Circuit d'approbation ----------

  // Ce que l'agent a devant lui — son équipe, ce qui attend son visa, ce
  // qu'il traite pour la DCH, par type : c'est l'organigramme qui le dit,
  // pas un rôle, d'où la question au serveur.
  @Get('absences/validations/compteurs')
  compteurs(@Req() req: AuthenticatedRequest) {
    return this.absences.compteurs(req.sessionUser);
  }

  /** Confier une demande à un membre de la DCH — ou la reprendre. */
  @Post('absence-requests/:id/confier')
  @HttpCode(200)
  confier(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(confierSchema)) body: ConfierInput,
  ) {
    return this.absences.confier(req.sessionUser, id, body.employeeId);
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
  @Peut('conges.soldes')
  @HttpCode(204)
  async setBalance(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(setBalanceSchema)) body: SetBalanceInput,
  ) {
    await this.absences.setBalance(req.sessionUser, body);
  }

  // ---------- Demandes ----------

  @Post('absence-preview')
  @FermeAuxInactifs()
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
  @FermeAuxInactifs()
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
