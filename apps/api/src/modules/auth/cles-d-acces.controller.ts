import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  reponseDeConnexionSchema,
  reponseDeCreationSchema,
  type OptionsDeConnexion,
  type OptionsDeCreation,
  type ReponseDeConnexion,
  type ReponseDeCreation,
  type SessionUser,
} from '@teranga/contracts';
import { CONNEXIONS_PAR_CLE, Limiteur, adresseDuClient } from '../../common/limiteur';
import { problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { DEFI_COOKIE, SESSION_COOKIE, optionsDuCookie } from './auth.constants';
import { ClesDAccesService } from './cles-d-acces.service';
import { SessionGuard, type AuthenticatedRequest } from './session.guard';

/** Le jeton du défi en cours, porté par le cookie de ce navigateur. */
const jetonDe = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[DEFI_COOKIE];

/**
 * Les clés d'accès (ADR-0247) : créer une clé, session ouverte ; ouvrir une
 * session avec elle.
 */
@Controller('auth/cles')
export class ClesDAccesController {
  constructor(
    @Inject(ClesDAccesService) private readonly service: ClesDAccesService,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
  ) {}

  /** Chaque geste de connexion se compte, par adresse réseau, avant tout travail. */
  private async limiter(req: Request, res: Response): Promise<void> {
    const verdict = await this.limiteur.compter(CONNEXIONS_PAR_CLE, adresseDuClient(req));
    if (!verdict.bloque) return;
    res.setHeader('Retry-After', String(verdict.reessayerDans));
    problem(
      429,
      'auth.trop_de_demandes',
      'Trop de demandes',
      `Réessayez dans ${Math.ceil(verdict.reessayerDans / 60)} min.`,
    );
  }

  @Post('creation/options')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async optionsDeCreation(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OptionsDeCreation> {
    const d = await this.service.optionsDeCreation(req.sessionUser);
    res.cookie(DEFI_COOKIE, d.jeton, optionsDuCookie(d.expiresAt));
    return d.options;
  }

  @Post('creation')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  @UsePipes(new ZodValidationPipe(reponseDeCreationSchema))
  async creer(
    @Body() body: ReponseDeCreation,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    try {
      await this.service.creer(jetonDe(req), req.sessionUser, body);
    } finally {
      // Pris ou non, le défi ne resservira pas.
      res.clearCookie(DEFI_COOKIE, optionsDuCookie());
    }
    return { ok: true };
  }

  @Post('connexion/options')
  @HttpCode(200)
  async optionsDeConnexion(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OptionsDeConnexion> {
    await this.limiter(req, res);
    const d = await this.service.optionsDeConnexion();
    res.cookie(DEFI_COOKIE, d.jeton, optionsDuCookie(d.expiresAt));
    return d.options;
  }

  @Post('connexion')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(reponseDeConnexionSchema))
  async seConnecter(
    @Body() body: ReponseDeConnexion,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SessionUser }> {
    await this.limiter(req, res);
    try {
      const session = await this.service.seConnecter(jetonDe(req), body, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      res.cookie(SESSION_COOKIE, session.token, optionsDuCookie(session.expiresAt));
      return { user: session.user };
    } finally {
      res.clearCookie(DEFI_COOKIE, optionsDuCookie());
    }
  }
}
