import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Teranga RH',
  description: 'La gestion RH et la paie de la zone UEMOA, au niveau des meilleurs SaaS mondiaux.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Aucune requête vers un tiers à l'exécution : Google Sans comme la police
    // d'icônes sont servies depuis /fonts (cf. scripts/fetch-text-font.mjs).
    // Un réseau d'administration filtrant ne change donc rien à l'affichage.
    <html lang="fr">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
