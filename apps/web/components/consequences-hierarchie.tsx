import type { ConsequencesHierarchie, MotifChangement } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { MOTS } from './bandeau-hierarchie';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Ce qu'une opération fait à la chaîne hiérarchique, dit AVANT de valider.

   Deux listes. En bleu, les N+1 que l'organigramme change de lui-même
   (ADR-0147) : l'opération les fera, on les montre pour qu'aucun ne
   surprenne. En orange, l'attente : les agents qu'elle laissera sans N+1
   hiérarchique, que le contrôle de la chaîne signalera ensuite.
   ———————————————————————————————————————————————————————————————— */

const MOTIFS: Record<MotifChangement, string> = {
  dg: 'DG : ne relève de personne',
  tete_de_direction: 'à la tête d’une direction : relève du DG',
  dga: 'DGA : relève du DG',
  unite_au_dessus: 'à la tête de son unité : relève de la tête de l’unité au-dessus',
  tete_de_son_unite: 'relève de la tête de son unité',
  niveau_au_dessus: 'son unité est sans tête : relève du premier niveau occupé au-dessus',
  direction_generale: 'rattachement direct à la Direction Générale : relève du DG',
  rattachement_choisi: 'relève de la place choisie à la Direction Générale',
  sans_unite: 'sans unité : plus de N+1 hiérarchique',
  sans_dg: 'la Direction Générale n’a pas de DG : plus de N+1 hiérarchique',
  fonctionnel_retire: 'son N+1 fonctionnel ne peut plus l’être : retour au N+1 hiérarchique',
};

export function aDesConsequences(c: ConsequencesHierarchie | null | undefined): boolean {
  return Boolean(c && (c.changements.length > 0 || c.aRevoir.length > 0));
}

export function ListeConsequences({
  consequences,
  faites = false,
}: {
  consequences: ConsequencesHierarchie;
  /** Après coup : « ont été mis à jour » plutôt que « seront ». */
  faites?: boolean;
}) {
  const { changements, aRevoir } = consequences;
  return (
    <div className="flex flex-col gap-3">
      {changements.length > 0 ? (
        <section>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.06em] text-primary uppercase">
            <Icon name="account_tree" size={14} />
            {faites ? 'Rattachements mis à jour' : 'Rattachements mis à jour automatiquement'}
          </h4>
          <ul className="flex flex-col gap-1">
            {changements.map((c) => (
              <li
                key={`${c.employeeId}-${c.motif}`}
                className="text-[12.5px] leading-snug text-ink"
              >
                <b className="font-semibold text-ink-strong">{c.nom}</b> :{' '}
                <span className="text-ink-muted">{c.avant ?? 'aucun N+1'}</span>
                <Icon name="arrow_forward" size={13} className="mx-1 align-[-2px] text-ink-muted" />
                <span className="font-semibold">{c.apres ?? 'aucun N+1'}</span>
                <span className="block text-[11.5px] text-ink-muted">{MOTIFS[c.motif]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {aRevoir.length > 0 ? (
        <section className="rounded-bloc border border-accent/25 bg-accent-soft/50 px-3 py-2.5">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.06em] text-accent-text uppercase">
            <Icon name="error" size={14} />
            {faites ? 'Rattachements à revoir' : 'Deviendront à revoir'}
          </h4>
          <ul className="flex flex-col gap-1">
            {aRevoir.map((a) => (
              <li key={`${a.employeeId}-${a.type}`} className="text-[12.5px] leading-snug text-ink">
                <b className="font-semibold text-ink-strong">{a.nom}</b>
                <span className={cn('ml-1.5 text-[11.5px] font-semibold text-accent-text')}>
                  {MOTS[a.type].court}
                </span>
                <span className="block text-[11.5px] text-ink-muted">
                  {MOTS[a.type].explication}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
