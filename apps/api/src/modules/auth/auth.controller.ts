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
import {
  ECHECS_PAR_ADRESSE,
  ECHECS_PAR_COMPTE,
  Limiteur,
  adresseDuClient,
  empreinte,
} from '../../common/limiteur';
import { ProblemException, problem } from '../../common/problem';
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
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
  ) {}

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

  /** La page d'inscription demande d'abord si elle peut s'afficher. */
  @Get('auth/inscription')
  async inscription(): Promise<{ ouverte: boolean }> {
    return { ouverte: await this.auth.inscriptionOuverte() };
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
    // Chaque essai coûte un calcul de mot de passe volontairement lent : les
    // échecs se comptent, par adresse et par compte, avant d'en lancer un.
    const essais = [
      [ECHECS_PAR_ADRESSE, adresseDuClient(req)],
      [ECHECS_PAR_COMPTE, empreinte(body.email)],
    ] as const;
    for (const [regle, sujet] of essais) {
      const verdict = await this.limiteur.consulter(regle, sujet);
      if (verdict.bloque) {
        res.setHeader('Retry-After', String(verdict.reessayerDans));
        problem(
          429,
          'auth.too_many_attempts',
          'Trop de tentatives de connexion',
          `Réessayez dans ${Math.ceil(verdict.reessayerDans / 60)} min.`,
        );
      }
    }
    let session: IssuedSession;
    try {
      session = await this.auth.login(body, meta(req));
    } catch (err) {
      if (err instanceof ProblemException && err.problem.code === 'auth.invalid_credentials') {
        for (const [regle, sujet] of essais) await this.limiteur.compter(regle, sujet);
      }
      throw err;
    }
    await this.limiteur.oublier(ECHECS_PAR_COMPTE, empreinte(body.email));
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

  /** Fermer toutes ses sessions, sur tous ses appareils : celle-ci comprise. */
  @Post('auth/deconnecter-partout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async deconnecterPartout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.deconnecterPartout(req.sessionUser.userId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: AuthenticatedRequest): SessionUser {
    return req.sessionUser;
  }
}
