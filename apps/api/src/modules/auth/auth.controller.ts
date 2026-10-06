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
  Logger,
  Param,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  demandeDeLienSchema,
  loginInputSchema,
  nouveauMotDePasseSchema,
  registerInputSchema,
  type DemandeDeLien,
  type LienDeReinitialisation,
  type LoginInput,
  type NouveauMotDePasse,
  type RegisterInput,
  type SessionUser,
} from '@teranga/contracts';
import {
  ECHECS_PAR_ADRESSE,
  ECHECS_PAR_COMPTE,
  Limiteur,
  OUBLIS_PAR_ADRESSE,
  OUBLIS_PAR_COMPTE,
  adresseDuClient,
  empreinte,
} from '../../common/limiteur';
import { ProblemException, problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { SESSION_COOKIE, optionsDuCookie } from './auth.constants';
import { AuthService, type IssuedSession } from './auth.service';
import { ReinitialisationService } from './reinitialisation.service';
import { AuthenticatedRequest, SessionGuard } from './session.guard';

function meta(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/** Un jeton de lien tel qu'on les fabrique (32 octets en base64url). */
const JETON = /^[A-Za-z0-9_-]{20,64}$/;

@Controller()
export class AuthController {
  private readonly logger = new Logger('Auth');

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
    @Inject(ReinitialisationService) private readonly reinitialisation: ReinitialisationService,
  ) {}

  private setCookie(res: Response, session: IssuedSession): void {
    res.cookie(SESSION_COOKIE, session.token, optionsDuCookie(session.expiresAt));
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

  /**
   * Mot de passe oublié : la même réponse, tout de suite, que l'adresse ait
   * un compte ou non. Le lien part ensuite, s'il doit partir.
   */
  @Post('auth/mot-de-passe-oublie')
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(demandeDeLienSchema))
  async motDePasseOublie(
    @Body() body: DemandeDeLien,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const demandes = [
      [OUBLIS_PAR_ADRESSE, adresseDuClient(req)],
      [OUBLIS_PAR_COMPTE, empreinte(body.email)],
    ] as const;
    for (const [regle, sujet] of demandes) {
      const verdict = await this.limiteur.compter(regle, sujet);
      if (verdict.bloque) {
        res.setHeader('Retry-After', String(verdict.reessayerDans));
        problem(
          429,
          'auth.trop_de_demandes',
          'Trop de demandes',
          `Réessayez dans ${Math.ceil(verdict.reessayerDans / 60)} min.`,
        );
      }
    }
    void this.reinitialisation
      .demander(body.email)
      .catch((e: Error) => this.logger.error(`Lien de réinitialisation : ${e.message}`));
  }

  @Get('auth/reinitialisation/:token')
  async lienDeReinitialisation(@Param('token') token: string): Promise<LienDeReinitialisation> {
    if (!JETON.test(token)) return { valide: false };
    return this.reinitialisation.lien(token);
  }

  @Post('auth/reinitialisation/:token')
  @HttpCode(204)
  async reinitialiser(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(nouveauMotDePasseSchema)) body: NouveauMotDePasse,
  ): Promise<void> {
    if (!JETON.test(token)) {
      problem(410, 'auth.lien_invalide', 'Ce lien n’est plus valable', 'Demandez un nouveau lien.');
    }
    const { email } = await this.reinitialisation.enregistrer(token, body.password);
    // Un nouveau mot de passe efface les essais manqués avec l'ancien.
    await this.limiteur.oublier(ECHECS_PAR_COMPTE, empreinte(email));
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.sessionToken);
    res.clearCookie(SESSION_COOKIE, optionsDuCookie());
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
    res.clearCookie(SESSION_COOKIE, optionsDuCookie());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: AuthenticatedRequest): SessionUser {
    return req.sessionUser;
  }
}
