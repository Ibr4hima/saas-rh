import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Teranga RH',
  description: 'La gestion RH et la paie de la zone UEMOA, au niveau des meilleurs SaaS mondiaux.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
