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
  UseGuards,
} from '@nestjs/common';
import {
  type ChangerReglagesInput,
  changerReglagesSchema,
  type ChangerSujetsInput,
  changerSujetsSchema,
  codeWhatsAppSchema,
  type Espace,
  notificationEspaceQuerySchema,
  type NotificationIdsInput,
  notificationIdsSchema,
  type NotificationScope,
  notificationScopeQuerySchema,
  numeroWhatsAppSchema,
} from '@teranga/contracts';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AccesGuard, Peut } from '../auth/acces.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { NotificationsService } from './notifications.service';
import { NotificationsReglagesService } from './reglages.service';

@Controller()
@UseGuards(SessionGuard, AccesGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(NotificationsReglagesService) private readonly reglages: NotificationsReglagesService,
  ) {}

  // Ses réglages : où chaque sujet le trouve, son numéro WhatsApp.

  @Get('notifications/reglages')
  lireReglages(@Req() req: AuthenticatedRequest) {
    return this.reglages.lire(req.sessionUser);
  }

  @Put('notifications/reglages/sujets')
  changerSujets(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(changerSujetsSchema)) body: ChangerSujetsInput,
  ) {
    return this.reglages.changerSujets(req.sessionUser, body);
  }

  @Put('notifications/reglages')
  changerReglages(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(changerReglagesSchema)) body: ChangerReglagesInput,
  ) {
    return this.reglages.changerReglages(req.sessionUser, body);
  }

  @Post('notifications/reglages/whatsapp/code')
  demanderCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(z.object({ numero: numeroWhatsAppSchema })))
    body: { numero: string },
  ) {
    return this.reglages.demanderCode(req.sessionUser, body.numero);
  }

  @Post('notifications/reglages/whatsapp/verification')
  verifierCode(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(codeWhatsAppSchema)) body: { code: string },
  ) {
    return this.reglages.verifierCode(req.sessionUser, body.code);
  }

  @Delete('notifications/reglages/whatsapp')
  retirerNumero(@Req() req: AuthenticatedRequest) {
    return this.reglages.retirerNumero(req.sessionUser);
  }

  // La boîte

  @Get('notifications')
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(notificationScopeQuerySchema))
    query: { scope: NotificationScope; espace?: Espace; limite: number },
  ) {
    return this.notifications.list(req.sessionUser, query.scope, query.espace, query.limite);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async markRead(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(req.sessionUser, id);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async markAllRead(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(notificationEspaceQuerySchema)) query: { espace?: Espace },
  ) {
    await this.notifications.markAllRead(req.sessionUser, query.espace);
  }

  /**
   * Ranger. Les routes de rangement portent une LISTE d'identifiants : c'est
   * un geste qu'on fait par lot (« je vide ce qui traîne »), et un aller-retour
   * par ligne ferait clignoter la boîte autant de fois qu'on a coché.
   */
  @Post('notifications/archive')
  @HttpCode(204)
  async archive(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(notificationIdsSchema)) body: NotificationIdsInput,
  ) {
    await this.notifications.archive(req.sessionUser, body.ids);
  }

  @Post('notifications/unarchive')
  @HttpCode(204)
  async unarchive(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(notificationIdsSchema)) body: NotificationIdsInput,
  ) {
    await this.notifications.unarchive(req.sessionUser, body.ids);
  }

  @Post('notifications/archive-all')
  @HttpCode(204)
  async archiveAll(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(notificationEspaceQuerySchema)) query: { espace?: Espace },
  ) {
    await this.notifications.archiveAll(req.sessionUser, query.espace);
  }

  /** Les contrats sous l'œil de la RH jusqu'à leur expiration. */
  @Get('contracts/expiring')
  @Peut('pilotage', 'personnel.consulter')
  expiring(@Req() req: AuthenticatedRequest) {
    return this.notifications.expiringContracts(req.sessionUser);
  }
}
