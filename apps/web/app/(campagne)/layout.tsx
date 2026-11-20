import type { Metadata } from 'next';
import { CoqueDeLaCampagne } from '../../components/campagne/coque';

export const metadata: Metadata = {
  title: 'Évaluation annuelle · APIX S.A',
};

/** La campagne d'évaluation annuelle (ADR-0211) : sans menu, l'évaluation seule. */
export default function CampagneLayout({ children }: { children: React.ReactNode }) {
  return <CoqueDeLaCampagne>{children}</CoqueDeLaCampagne>;
}
