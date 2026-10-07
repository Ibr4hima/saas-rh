import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import { SCRIPT_AMORCAGE } from '../components/preferences';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'SGRH · APIX S.A',
  description: 'La gestion RH et la paie de la zone UEMOA, au niveau des meilleurs SaaS mondiaux.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Le jeton de la page (cf. middleware.ts) : sans lui, le navigateur
  // refuserait le script du thème comme n'importe quel script injecté.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    // Aucune requête vers un tiers à l'exécution : Google Sans comme la police
    // d'icônes sont servies depuis /fonts (cf. scripts/fetch-text-font.mjs).
    // Un réseau d'administration filtrant ne change donc rien à l'affichage.
    // `data-theme` est posé ici à sa valeur par DÉFAUT, puis corrigé par le
    // script ci-dessous si une préférence a été gardée.
    // Le thème ne suit plus `prefers-color-scheme` : la plateforme s'ouvre en
    // clair, et c'est l'utilisateur — pas son système — qui décide d'en
    // changer.
    // `suppressHydrationWarning` : les attributs sont modifiés avant
    // l'hydratation, et React ne doit pas le reprocher au serveur qui les
    // ignorait.
    <html lang="fr" data-theme="light" suppressHydrationWarning>
      <head>
        {/* Le navigateur efface la valeur du nonce une fois la page chargée,
            pour qu'un script injecté ne la lise pas : React trouverait
            `nonce=""` là où le serveur l'a écrite. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: SCRIPT_AMORCAGE }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
