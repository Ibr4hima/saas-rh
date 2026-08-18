import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createEmployeeSchema,
  createOrgUnitSchema,
  importEmployeesSchema,
  listEmployeesQuerySchema,
  newAssignmentSchema,
  updateEmployeeSchema,
  updateOrgUnitSchema,
  type CreateEmployeeInput,
  type ListEmployeesQuery,
  type CreateOrgUnitInput,
  type ImportEmployeesInput,
  type NewAssignmentInput,
  type UpdateEmployeeInput,
  type UpdateOrgUnitInput,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ImportService } from './import.service';
import { OrgUnitsService } from './org-units.service';
import { PeopleService } from './people.service';

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class PeopleController {
  constructor(
    @Inject(PeopleService) private readonly people: PeopleService,
    @Inject(OrgUnitsService) private readonly orgUnits: OrgUnitsService,
    @Inject(ImportService) private readonly importer: ImportService,
  ) {}

  // ---------- Employés ----------

  @Get('employees')
  @Roles('admin', 'hr', 'payroll')
  listEmployees(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listEmployeesQuerySchema)) query: ListEmployeesQuery,
  ) {
    return this.people.list(req.sessionUser, query);
  }

  @Post('employees')
  @Roles('admin', 'hr')
  createEmployee(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
  ) {
    return this.people.create(req.sessionUser, body);
  }

  @Get('employees/:id')
  employeeDetail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.people.detail(req.sessionUser, id);
  }

  @Patch('employees/:id')
  @Roles('admin', 'hr')
  @HttpCode(204)
  async updateEmployee(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
  ) {
    await this.people.update(req.sessionUser, id, body);
  }

  @Post('employees/:id/assignments')
  @Roles('admin', 'hr')
  @HttpCode(204)
  async newAssignment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(newAssignmentSchema)) body: NewAssignmentInput,
  ) {
    await this.people.newAssignment(req.sessionUser, id, body);
  }

  @Get('employees/:id/history')
  @Roles('admin', 'hr')
  history(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.people.history(req.sessionUser, id);
  }

  @Post('employees/import')
  @Roles('admin', 'hr')
  importEmployees(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(importEmployeesSchema)) body: ImportEmployeesInput,
  ) {
    return this.importer.importEmployees(req.sessionUser, body.content, body.dryRun);
  }

  // ---------- Organisation ----------

  @Get('org-units')
  listOrgUnits(@Req() req: AuthenticatedRequest) {
    return this.orgUnits.list(req.sessionUser);
  }

  @Post('org-units')
  @Roles('admin', 'hr')
  createOrgUnit(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createOrgUnitSchema)) body: CreateOrgUnitInput,
  ) {
    return this.orgUnits.create(req.sessionUser, body);
  }

  @Patch('org-units/:id')
  @Roles('admin', 'hr')
  @HttpCode(204)
  async updateOrgUnit(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOrgUnitSchema)) body: UpdateOrgUnitInput,
  ) {
    await this.orgUnits.update(req.sessionUser, id, body);
  }

  /** Annuaire interne : visible par tous les rôles (« qui se référer »). */
  @Get('org-units/:id/members')
  orgUnitMembers(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.orgUnits.members(req.sessionUser, id);
  }
}
