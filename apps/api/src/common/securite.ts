import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env';

/* ────────────────────────────────────────────────────────────────
   Ce que l'API dit au navigateur, et ce qu'elle refuse d'emblée.

   - Les origines autorisées : le site (PUBLIC_WEB_URL) et celles qu'on
     nomme (CORS_ORIGINS). En développement, les ports locaux en plus.
   - Le contrôle d'origine : un geste (tout ce qui n'est pas une lecture)
     venu d'un autre site est refusé, même si le cookie le laissait
     passer. Le navigateur dit d'où vient la requête (Origin,
     Sec-Fetch-Site) ; un script d'un autre site ne peut pas le cacher.
   - Les en-têtes : rien ne s'affiche dans un cadre, rien ne se devine,
     rien ne reste en cache, et le navigateur ne parle plus qu'en HTTPS.
   ──────────────────────────────────────────────────────────────── */

/** Les ports du développement : le site (3002) et son ancien port (3000). */
const ORIGINES_DE_DEVELOPPEMENT = ['http://localhost:3000', 'http://localhost:3002'];

export function originesAutorisees(
  env: Pick<Env, 'NODE_ENV' | 'PUBLIC_WEB_URL' | 'CORS_ORIGINS'>,
): string[] {
  const origines = new Set([new URL(env.PUBLIC_WEB_URL).origin, ...env.CORS_ORIGINS]);
  if (env.NODE_ENV !== 'production') {
    for (const o of ORIGINES_DE_DEVELOPPEMENT) origines.add(o);
  }
  return [...origines];
}

const LECTURES = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuse un geste venu d'un autre site. Une requête sans Origin (un outil
 * en ligne de commande, un serveur) passe : elle ne porte pas le cookie
 * d'un visiteur à son insu.
 */
export function controleDOrigine(origines: string[]) {
  const permises = new Set(origines);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (LECTURES.has(req.method)) return next();
    const origine = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    const etrangere =
      (typeof origine === 'string' && origine !== 'null' && !permises.has(origine)) ||
      origine === 'null' ||
      site === 'cross-site';
    if (!etrangere) return next();
    res.status(403).type('application/problem+json').json({
      type: 'about:blank',
      title: 'Origine refusée',
      status: 403,
      code: 'securite.origine_refusee',
      detail: 'Cette action ne peut venir que du portail.',
    });
  };
}

/**
 * Les en-têtes de chaque réponse. Une route qui sert un fichier peut
 * préciser son cache ; par défaut, rien ne se garde : une fiche, un
 * bulletin, une pièce d'identité ne restent pas dans le navigateur d'un
 * poste partagé.
 */
export function entetesDeSecurite(env: Pick<Env, 'COOKIE_SECURE'>) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    res.setHeader('Cache-Control', 'no-store');
    if (env.COOKIE_SECURE) {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    next();
  };
}
