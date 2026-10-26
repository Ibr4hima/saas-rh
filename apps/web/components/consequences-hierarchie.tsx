import type { ConsequencesHierarchie, MotifChangement } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { MOTS } from './bandeau-hierarchie';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Ce qu'une opération fait à la chaîne hiérarchique — dit AVANT de valider.

   Deux listes. En bleu, les rattachements que la règle change d'elle-même
   (un nouveau DG reprend les directeurs, un repreneur reprend une équipe) :
   l'opération les fera, on les montre pour qu'aucun ne surprenne. En orange
   — l'attente —, ceux qu'elle rendra FAUX et qu'il faudra revoir : le
   contrôle de la chaîne les signalera ensuite.
   ———————————————————————————————————————————————————————————————— */

const MOTIFS: Record<MotifChangement, string> = {
  devient_dg: 'devient DG : n’a plus de N+1',
  suit_le_dg: 'avait pour N+1 l’ancien DG',
  devient_dga: 'devient DGA : a pour N+1 le DG',
  suit_le_dga: 'avait pour N+1 l’ancien DGA',
  directeur: 'dirige une direction : a pour N+1 le DG',
  ancien_dg: 'ancien DG, resté à la Direction Générale',
  direction_pourvue: 'sa direction a un nouveau responsable',
  chef_d_unite: 'a pour N+1 le responsable de l’unité supérieure',
  suit_le_directeur: 'avait pour N+1 l’ancien responsable de la direction',
  ancien_directeur: 'ancien responsable, resté dans la direction',
  suit_le_chef: 'avait pour N+1 l’ancien responsable de l’unité',
  ancien_chef: 'ancien responsable, resté dans l’unité',
  reprise_equipe: 'reprise de l’équipe',
  prend_la_place: 'remplace le responsable qui part',
  responsable_de_sa_direction: 'a désormais pour N+1 le responsable de sa direction',
  retour_du_responsable: 'son N+1 est de retour',
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
              <li key={c.employeeId} className="text-[12.5px] leading-snug text-ink">
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
            {faites ? 'Rattachements à revoir' : 'À revoir après l’enregistrement'}
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
