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
  devient_dg: 'devient directeur général : ne relève plus de personne',
  suit_le_dg: 'relevait de l’ancien directeur général',
  directeur: 'un directeur relève du directeur général',
  ancien_dg: 'ancien directeur général, resté à la Direction Générale',
  direction_pourvue: 'sa direction a désormais un directeur',
  ancien_directeur: 'ancien directeur, resté dans la direction',
  reprise_equipe: 'reprise de l’équipe',
  prend_la_place: 'prend la place de celui qui part',
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
                <span className="text-ink-muted">{c.avant ?? 'aucun n+1'}</span>
                <Icon name="arrow_forward" size={13} className="mx-1 align-[-2px] text-ink-muted" />
                <span className="font-semibold">{c.apres ?? 'aucun n+1'}</span>
                <span className="block text-[11.5px] text-ink-muted">{MOTIFS[c.motif]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {aRevoir.length > 0 ? (
        <section className="rounded-[10px] border border-accent/25 bg-accent-soft/50 px-3 py-2.5">
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
