import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UsePipes } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  demandeDeCodeSchema,
  saisieDuCodeSchema,
  type AttenteDuCode,
  type DemandeDeCode,
  type EtatDeLAttente,
  type InfoDuCode,
  type SaisieDuCode,
  type SessionUser,
} from '@teranga/contracts';
import {
  DEMANDES_DE_CODE,
  ESSAIS_DE_CODE,
  Limiteur,
  RENVOIS_DE_CODE,
  adresseDuClient,
  type Regle,
} from '../../common/limiteur';
import { problem } from '../../common/problem';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { ATTENTE_COOKIE, SESSION_COOKIE, optionsDuCookie } from './auth.constants';
import { ConnexionParCodeService } from './connexion-par-code.service';

/** Le jeton de la connexion en cours, porté par le cookie de ce navigateur. */
const jetonDe = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[ATTENTE_COOKIE];

/**
 * La connexion par code (ADR-0204) : la demande, l'écran du code, le code
 * saisi, le code redemandé.
 */
@Controller('auth/code')
export class ConnexionParCodeController {
  constructor(
    @Inject(ConnexionParCodeService) private readonly service: ConnexionParCodeService,
    @Inject(Limiteur) private readonly limiteur: Limiteur,
  ) {}

  /** Chaque geste se compte, par adresse réseau, avant tout travail. */
  private async limiter(regle: Regle, req: Request, res: Response): Promise<void> {
    const verdict = await this.limiteur.compter(regle, adresseDuClient(req));
    if (!verdict.bloque) return;
    res.setHeader('Retry-After', String(verdict.reessayerDans));
    problem(
      429,
      'auth.trop_de_demandes',
      'Trop de demandes',
      `Réessayez dans ${Math.ceil(verdict.reessayerDans / 60)} min.`,
    );
  }

  /**
   * La même réponse, tout de suite, que le nom et l'adresse correspondent à
   * un compte ou non : le code part ensuite, s'il doit partir.
   */
  @Post('demande')
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(demandeDeCodeSchema))
  async demander(
    @Body() body: DemandeDeCode,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AttenteDuCode> {
    await this.limiter(DEMANDES_DE_CODE, req, res);
    const demande = await this.service.demander(body, jetonDe(req));
    void demande.enFond;
    res.cookie(ATTENTE_COOKIE, demande.jeton, optionsDuCookie(demande.expiresAt));
    return demande.attente;
  }

  @Get()
  etat(@Req() req: Request): Promise<EtatDeLAttente> {
    return this.service.etat(jetonDe(req));
  }

  @Post()
  @HttpCode(200)
  @UsePipes(new ZodValidationPipe(saisieDuCodeSchema))
  async valider(
    @Body() body: SaisieDuCode,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: SessionUser }> {
    await this.limiter(ESSAIS_DE_CODE, req, res);
    const session = await this.service.verifier(jetonDe(req), body.code, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    res.cookie(SESSION_COOKIE, session.token, optionsDuCookie(session.expiresAt));
    res.clearCookie(ATTENTE_COOKIE, optionsDuCookie());
    return { user: session.user };
  }

  @Post('renvoi')
  @HttpCode(200)
  async renvoyer(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ info: InfoDuCode }> {
    await this.limiter(RENVOIS_DE_CODE, req, res);
    const { info, enFond } = await this.service.renvoyer(jetonDe(req));
    void enFond;
    return { info };
  }
}
