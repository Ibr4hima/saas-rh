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
  UseGuards,
} from '@nestjs/common';
import {
  archiveEmployeesSchema,
  createEmployeeSchema,
  createOrgUnitSchema,
  deleteEmployeesSchema,
  deleteOrgUnitSchema,
  listEmployeesQuerySchema,
  newAssignmentSchema,
  updateEmployeeSchema,
  updateOrgUnitSchema,
  type ArchiveEmployeesInput,
  type CreateEmployeeInput,
  type DeleteEmployeesInput,
  type ListEmployeesQuery,
  type CreateOrgUnitInput,
  type DeleteOrgUnitInput,
  type NewAssignmentInput,
  type UpdateEmployeeInput,
  type UpdateOrgUnitInput,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { HierarchieService } from './hierarchie.service';
import { ImportEmployesService } from './import.service';
import { OrgUnitsService } from './org-units.service';
import { PeopleService } from './people.service';

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class PeopleController {
  constructor(
    @Inject(PeopleService) private readonly people: PeopleService,
    @Inject(OrgUnitsService) private readonly orgUnits: OrgUnitsService,
    @Inject(ImportEmployesService) private readonly imports: ImportEmployesService,
    @Inject(HierarchieService) private readonly hierarchie: HierarchieService,
  ) {}

  // ---------- Chaîne hiérarchique ----------

  /**
   * Le contrôle de la chaîne : qui n'a pas de n+1, qui en a un hors de sa
   * direction, quelles boucles existent.
   *
   * En lecture seule, et volontairement : il SIGNALE, il ne corrige rien
   * d'office. Les dossiers déjà créés sans responsable restent en place — on
   * leur en désigne un, dossier par dossier.
   */
  @Get('hierarchie/controle')
  @Roles('admin', 'hr')
  controleHierarchie(@Req() req: AuthenticatedRequest) {
    return this.hierarchie.controle(req.sessionUser);
  }

  // ---------- Employés ----------

  @Get('employees')
  @Roles('admin', 'hr', 'payroll')
  listEmployees(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listEmployeesQuerySchema)) query: ListEmployeesQuery,
  ) {
    return this.people.list(req.sessionUser, query);
  }

  /**
   * L'import d'un fichier d'effectif.
   *
   * Le classeur arrive en BINAIRE (un .xlsx est une archive), et le même
   * envoi sert deux fois : `?apercu=1` lit et rend le compte rendu sans rien
   * écrire, sans le paramètre il applique. Déclarée AVANT « employees/:id »,
   * comme les autres routes nommées : Nest apparie dans l'ordre.
   */
  @Post('employees/import')
  @Roles('admin', 'hr')
  importerEmployes(@Req() req: AuthenticatedRequest, @Query('apercu') apercu: string | undefined) {
    const fichier = (req as unknown as { body?: unknown }).body;
    if (!Buffer.isBuffer(fichier) || fichier.length === 0) {
      problem(415, 'import.corps_absent', 'Envoyez le classeur .xlsx en corps de requête');
    }
    return this.imports.importer(req.sessionUser, fichier, apercu !== '1');
  }

  @Post('employees')
  @Roles('admin', 'hr')
  createEmployee(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
  ) {
    return this.people.create(req.sessionUser, body);
  }

  /**
   * Archiver ou réactiver, toujours par lot — même pour un seul dossier. Deux
   * chemins pour un même geste finiraient par diverger.
   *
   * Déclarées AVANT « employees/:id » : Nest apparie dans l'ordre, et une route
   * paramétrée placée plus haut capterait « archive » comme un identifiant.
   */
  @Post('employees/archive')
  @Roles('admin', 'hr')
  archiveEmployees(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(archiveEmployeesSchema)) body: ArchiveEmployeesInput,
  ) {
    return this.people.archive(req.sessionUser, body);
  }

  /** Suppression définitive — réservée à l'administrateur. */
  @Post('employees/delete')
  @Roles('admin')
  deleteEmployees(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(deleteEmployeesSchema)) body: DeleteEmployeesInput,
  ) {
    return this.people.remove(req.sessionUser, body);
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

  /**
   * Dissolution d'une unité (effacement doux). Ses membres sont réaffectés à
   * l'unité désignée : personne ne se retrouve sans rattachement.
   */
  @Delete('org-units/:id')
  @Roles('admin', 'hr')
  @HttpCode(204)
  async deleteOrgUnit(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(deleteOrgUnitSchema)) query: DeleteOrgUnitInput,
  ) {
    await this.orgUnits.remove(req.sessionUser, id, query);
  }

  /** Qui peut diriger cette unité : le sous-arbre actif, rien de plus. */
  @Get('org-units/:id/eligible-managers')
  @Roles('admin', 'hr')
  eligibleManagers(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.orgUnits.eligibleManagers(req.sessionUser, id);
  }

  /** Annuaire interne : visible par tous les rôles (« qui se référer »). */
  @Get('org-units/:id/members')
  orgUnitMembers(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.orgUnits.members(req.sessionUser, id);
  }
}
