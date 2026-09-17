import Link from 'next/link';
import { Badge, CardContent } from '@teranga/ui';
import { CartePleine, Page } from '../../../components/gabarit';

export default function EvaluationPage() {
  return (
    <Page>
      <div className="shrink-0">
        <Badge tone="primary">Bientôt disponible</Badge>
      </div>
      {/* L'écran d'un module à venir n'est pas une exception au gabarit : sa
          carte occupe la page comme les autres, et son contenu se centre
          dedans plutôt que de se tasser en haut d'un fond nu. */}
      <CartePleine className="justify-center">
        <CardContent className="flex flex-col gap-3 py-8 text-sm text-ink">
          <p className="font-medium text-ink-strong">
            Le module évaluation des performances arrive dans une prochaine version.
          </p>
          <p className="text-ink-muted">Au programme, conformément à la feuille de route :</p>
          <ul className="list-disc pl-5 text-ink-muted">
            <li>Objectifs individuels et d&apos;équipe, suivis dans le temps</li>
            <li>Campagnes d&apos;entretiens annuels avec grilles configurables</li>
            <li>Compatibilité avec la notation administrative du secteur public</li>
            <li>Historique des évaluations rattaché au dossier employé</li>
          </ul>
          <p className="text-xs text-ink-muted">
            Référence : dossier d&apos;architecture, chapitre 01 (§6.7) — priorité V2.{' '}
            <Link href="/employees" className="text-primary hover:underline">
              Revenir aux employés
            </Link>
          </p>
        </CardContent>
      </CartePleine>
    </Page>
  );
}
