import Link from 'next/link';
import type { StatutSuivi, TeamCourseProgress, TeamMember } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { ETATS_SUIVI, FAMILLES, FOND_COUVERTURE, pourcent } from '../lib/academy';
import { formatDate } from '../lib/hooks';
import { anciennete } from '../lib/temps';
import { BarreProgression } from './academy-carte';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   « Mon équipe » — les pièces : un agent en une ligne, une formation en une
   ligne, et la pastille qui dit où il en est.

   Trois chiffres par agent, pas davantage : ce qu'il SUIT, ce qui
   l'ATTEND, ce qu'il a OBTENU. Le reste est sur sa fiche, à un clic.
   ———————————————————————————————————————————————————————————————— */

const TONS = {
  attente: 'bg-accent-soft/70 text-accent-text ring-accent/25',
  succes: 'bg-success-soft/55 text-success ring-success/25',
  suivi: 'bg-primary-soft/55 text-primary ring-primary/25',
  neutre: 'bg-line-soft/55 text-ink-muted ring-ink-muted/20',
} as const;

export function PastilleEtat({ statut, className }: { statut: StatutSuivi; className?: string }) {
  const e = ETATS_SUIVI[statut];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset',
        TONS[e.ton],
        className,
      )}
    >
      <Icon name={e.icone} size={13} fill={e.ton === 'succes'} />
      {e.label}
    </span>
  );
}

export function Initiales({
  prenom,
  nom,
  grand = false,
}: {
  prenom: string;
  nom: string;
  grand?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-primary-soft font-bold text-primary',
        grand ? 'size-14 text-[18px]' : 'size-9 text-[12px]',
      )}
    >
      {`${prenom[0] ?? ''}${nom[0] ?? ''}`.toUpperCase()}
    </span>
  );
}

/** Ce qu'il suit, ce qui l'attend, ce qu'il a obtenu. */
export function chiffresDe(m: TeamMember) {
  return {
    enCours: m.counts.en_cours,
    aEvaluer: m.counts.evaluation_a_passer + m.counts.non_reussie,
    obtenues: m.counts.certifiee + m.counts.terminee,
  };
}

function Chiffre({ n, attente = false }: { n: number; attente?: boolean }) {
  return (
    <span
      className={cn(
        'text-[14px] font-bold',
        n === 0 ? 'text-ink-muted/60' : attente ? 'text-accent-text' : 'text-ink-strong',
      )}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {n}
    </span>
  );
}

/** L'en-tête des colonnes, au-dessus des lignes d'agents — sur écran large seulement. */
export function EnteteColonnes() {
  return (
    <div className="hidden items-center gap-4 border-b border-line-soft px-3 pb-2.5 text-[10.5px] font-bold tracking-[0.08em] whitespace-nowrap text-ink-muted uppercase sm:flex">
      <span className="min-w-0 flex-1">Agent</span>
      <span className="w-20 text-center">En cours</span>
      <span className="w-28 text-center">À l’évaluation</span>
      <span className="w-20 text-center">Obtenues</span>
      <span className="w-40">Dernière activité</span>
      <span className="w-4" />
    </div>
  );
}

export function LigneAgent({ membre }: { membre: TeamMember }) {
  const c = chiffresDe(membre);
  const poste = [membre.positionTitle, membre.unitName].filter(Boolean).join(' · ');
  const activite = membre.lastActivityAt ? `il y a ${anciennete(membre.lastActivityAt)}` : null;
  return (
    <li className="border-b border-line-soft last:border-b-0">
      <Link
        href={`/academy/equipe/${membre.employeeId}`}
        className="group flex flex-col gap-2 rounded-[12px] px-3 py-3 transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <Initiales prenom={membre.givenName} nom={membre.familyName} />
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-bold text-ink-strong">
              {membre.givenName} {membre.familyName}
            </span>
            <span className="block truncate text-[11.5px] text-ink-muted">
              {poste || membre.number}
            </span>
          </span>
        </span>

        {/* Sur téléphone, les trois chiffres se disent en mots, sous le nom. */}
        <span className="flex flex-wrap gap-x-3 gap-y-1 pl-12 text-[11.5px] text-ink-muted sm:hidden">
          <span>
            <b className="font-bold text-ink-strong">{c.enCours}</b> en cours
          </span>
          <span className={cn(c.aEvaluer > 0 && 'text-accent-text')}>
            <b className="font-bold">{c.aEvaluer}</b> à l’évaluation
          </span>
          <span>
            <b className="font-bold text-ink-strong">{c.obtenues}</b>{' '}
            {c.obtenues > 1 ? 'obtenues' : 'obtenue'}
          </span>
          <span>{activite ?? 'Aucune activité'}</span>
        </span>

        <span className="hidden w-20 text-center sm:block">
          <Chiffre n={c.enCours} />
        </span>
        <span className="hidden w-28 text-center sm:block">
          <Chiffre n={c.aEvaluer} attente />
        </span>
        <span className="hidden w-20 text-center sm:block">
          <Chiffre n={c.obtenues} />
        </span>
        <span className="hidden w-40 truncate text-[12px] text-ink-muted sm:block">
          {activite ?? '—'}
        </span>
        {/* L'icône impose son propre affichage : c'est l'enveloppe qui se cache. */}
        <span className="hidden w-4 items-center text-ink-muted/60 transition-transform group-hover:translate-x-0.5 sm:flex">
          <Icon name="chevron_right" size={18} />
        </span>
      </Link>
    </li>
  );
}

/** Une formation sur la fiche d'un agent : où il en est, et depuis quand. */
export function LigneFormationSuivie({ formation }: { formation: TeamCourseProgress }) {
  const famille = FAMILLES[formation.category];
  const f = formation;
  const details: string[] = [famille.label];
  if (f.lessonCount > 0 && f.status !== 'certifiee' && f.status !== 'a_commencer') {
    details.push(`${f.completedLessons}/${f.lessonCount} leçons`);
  }
  if (f.status !== 'certifiee' && f.lastActivityAt) {
    details.push(`il y a ${anciennete(f.lastActivityAt)}`);
  }
  if (f.certificate?.status === 'valide') {
    details.push(
      `réussie à ${pourcent(f.certificate.score)} le ${formatDate(f.certificate.issuedAt)}`,
    );
    if (f.certificate.expiresAt) details.push(`jusqu’au ${formatDate(f.certificate.expiresAt)}`);
  }
  return (
    <li className="flex flex-col gap-2 border-b border-line-soft py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-[10px] text-white"
          style={{ background: FOND_COUVERTURE }}
        >
          <Icon name={famille.icone} size={18} />
        </span>
        <span className="min-w-0">
          <span className="line-clamp-2 text-[13px] font-bold text-ink-strong sm:line-clamp-1">
            {f.title}
          </span>
          <span className="block text-[11.5px] text-ink-muted sm:truncate">
            {details.join(' · ')}
          </span>
          {f.certificate?.status === 'expire' ? (
            <span className="block text-[11.5px] text-accent-text">
              Certificat expiré le {formatDate(f.certificate.expiresAt!)}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex items-center gap-3 pl-12 sm:pl-0">
        {f.status === 'en_cours' ? (
          <span className="flex w-40 items-center gap-2.5">
            <BarreProgression part={f.completedLessons / f.lessonCount} className="flex-1" />
            <span
              className="text-[11.5px] font-semibold text-ink-muted"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {f.completedLessons}/{f.lessonCount}
            </span>
          </span>
        ) : (
          <PastilleEtat statut={f.status} />
        )}
      </span>
    </li>
  );
}
