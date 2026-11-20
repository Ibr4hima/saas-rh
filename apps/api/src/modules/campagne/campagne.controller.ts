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
  UseGuards,
} from '@nestjs/common';
import {
  ecritureDeLAutoSchema,
  ecritureDeLEvaluationSchema,
  type EcritureDeLAuto,
  type EcritureDeLEvaluation,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, FermeAuxInactifs } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { CampagneService } from './campagne.service';

/**
 * La campagne d'évaluation annuelle (ADR-0211, ADR-0215, ADR-0216) : ouverte
 * à tout agent. On n'y lit que sa propre fiche et celles des agents qu'on
 * évalue ; on n'y écrit que sa propre auto-évaluation, et l'évaluation des
 * agents qu'on évalue.
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

  /** L'évaluation, complète, transmise à l'agent. */
  @Post('equipe/:employeeId/evaluation/transmission')
  @HttpCode(200)
  transmettreEvaluation(
    @Req() req: AuthenticatedRequest,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body(new ZodValidationPipe(ecritureDeLEvaluationSchema)) body: EcritureDeLEvaluation,
  ) {
    return this.campagne.transmettreEvaluation(req.sessionUser, employeeId, body);
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
