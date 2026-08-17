import Link from 'next/link';
import { Badge, Card, CardContent } from '@teranga/ui';

export default function RecrutementPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink-strong">Recrutement</h1>
        <Badge tone="primary">Bientôt disponible</Badge>
      </div>
      <Card>
        <CardContent className="flex flex-col gap-3 py-8 text-sm text-ink">
          <p className="font-medium text-ink-strong">
            Le module recrutement arrive dans une prochaine version.
          </p>
          <p className="text-ink-muted">Au programme, conformément à la feuille de route :</p>
          <ul className="list-disc pl-5 text-ink-muted">
            <li>Publication des offres et page carrière publique</li>
            <li>Collecte des CVs et vivier de candidatures réutilisable</li>
            <li>
              Présélection assistée par IA — avec argumentaire, jamais de décision automatique
            </li>
            <li>Grilles d&apos;entretien (scorecards) et suivi du pipeline par poste</li>
            <li>Transformation du candidat retenu en dossier employé, sans resaisie</li>
          </ul>
          <p className="text-xs text-ink-muted">
            Référence : dossier d&apos;architecture, chapitre 01 (§6.4) — priorité V2.{' '}
            <Link href="/employees" className="text-primary hover:underline">
              Revenir aux employés
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
