import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  Inject,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  loginInputSchema,
  registerInputSchema,
  type LoginInput,
  type RegisterInput,
  type SessionUser,
} from '@teranga/contracts';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { loadEnv } from '../../config/env';
import { SESSION_COOKIE } from './auth.constants';
import { AuthService, type IssuedSession } from './auth.service';
import { AuthenticatedRequest, SessionGuard } from './session.guard';

function meta(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  private setCookie(res: Response, session: IssuedSession): void {
    const env = loadEnv();
    res.cookie(SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: session.expiresAt,
    });
  }

  @Post('auth/register')
  @UsePipes(new ZodValidationPipe(registerInputSchema))
  async register(
    @Body() body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SessionUser }> {
    const session = await this.auth.register(body, meta(req));
    this.setCookie(res, session);
    return { user: session.user };
  }

  @Post('auth/login')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(loginInputSchema))
  async login(
    @Body() body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SessionUser }> {
    const session = await this.auth.login(body, meta(req));
    this.setCookie(res, session);
    return { user: session.user };
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: AuthenticatedRequest): SessionUser {
    return req.sessionUser;
  }
}
