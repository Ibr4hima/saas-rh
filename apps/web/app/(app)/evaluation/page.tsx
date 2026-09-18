import Link from 'next/link';
import { ModuleAVenir } from '../../../components/module-a-venir';

export default function EvaluationPage() {
  return (
    <ModuleAVenir
      icone="rule"
      promesse="Ce sur quoi chaque agent s’est engagé cette année, et où il en est."
      points={[
        'Des objectifs individuels et d’équipe, suivis dans le temps plutôt que relus une fois l’an.',
        'Des campagnes d’entretien annuel, avec des grilles que la Direction du Capital Humain paramètre elle-même.',
        'La notation administrative du secteur public, à côté de l’appréciation managériale — les deux coexistent dans une agence publique.',
        'L’historique des évaluations rattaché au dossier de l’agent, et repris dans sa cartographie de compétences.',
      ]}
      note={
        <>
          Référence : dossier d’architecture, chapitre 01 (§4.2) — module « Performance & objectifs
          », priorité V2.{' '}
          <Link href="/employees" className="text-primary hover:underline">
            Revenir au personnel
          </Link>
        </>
      }
    />
  );
}
