import { NextResponse, type NextRequest } from 'next/server';

/* ────────────────────────────────────────────────────────────────
   La politique de sécurité du contenu, page par page.

   Chaque page reçoit un jeton tiré au hasard (nonce) : seuls les scripts
   qui le portent s'exécutent, ceux du site et ceux qu'ils chargent. Un
   script glissé dans une page par un tiers (une donnée mal échappée, une
   extension) ne le connaît pas : le navigateur le refuse. La page ne parle
   qu'au site et à l'API, ne s'affiche dans aucun cadre, et n'envoie aucun
   formulaire ailleurs.
   ──────────────────────────────────────────────────────────────── */

const API = new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').origin;

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV === 'development';
  const politique = [
    "default-src 'self'",
    // Le rechargement à chaud du développement évalue du code : là seulement.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Les styles posés par les composants (l'éditeur, les positions
    // calculées) : un style ne s'exécute pas.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${API}`,
    "font-src 'self' data:",
    `connect-src 'self' ${API}${dev ? ' ws:' : ''}`,
    `media-src 'self' blob: ${API}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const entetes = new Headers(request.headers);
  entetes.set('x-nonce', nonce);
  entetes.set('Content-Security-Policy', politique);
  const reponse = NextResponse.next({ request: { headers: entetes } });
  reponse.headers.set('Content-Security-Policy', politique);
  return reponse;
}

export const config = {
  matcher: [
    {
      // Les fichiers servis tels quels n'exécutent rien : ni police, ni image.
      source:
        '/((?!_next/static|_next/image|fonts/|courriel/|favicon|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|webmanifest)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
