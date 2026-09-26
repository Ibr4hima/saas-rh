import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type NotificationIdsInput,
  notificationIdsSchema,
  type NotificationScope,
  notificationScopeQuerySchema,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(notificationScopeQuerySchema)) query: { scope: NotificationScope },
  ) {
    return this.notifications.list(req.sessionUser, query.scope);
  }

  @Post('notifications/:id/read')
  @HttpCode(204)
  async markRead(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(req.sessionUser, id);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async markAllRead(@Req() req: AuthenticatedRequest) {
    await this.notifications.markAllRead(req.sessionUser);
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
  async archiveAll(@Req() req: AuthenticatedRequest) {
    await this.notifications.archiveAll(req.sessionUser);
  }

  /** Les contrats sous l'œil de la RH jusqu'à leur expiration. */
  @Get('contracts/expiring')
  @Roles('admin', 'hr', 'payroll')
  expiring(@Req() req: AuthenticatedRequest) {
    return this.notifications.expiringContracts(req.sessionUser);
  }
}
