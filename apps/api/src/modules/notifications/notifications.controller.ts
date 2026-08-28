import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(SessionGuard, RolesGuard)
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@Req() req: AuthenticatedRequest) {
    return this.notifications.list(req.sessionUser);
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

  /** Les contrats sous l'œil de la RH jusqu'à leur expiration. */
  @Get('contracts/expiring')
  @Roles('admin', 'hr', 'payroll')
  expiring(@Req() req: AuthenticatedRequest) {
    return this.notifications.expiringContracts(req.sessionUser);
  }
}
