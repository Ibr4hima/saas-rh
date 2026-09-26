import Link from 'next/link';
import type { CourseDetail, LessonView, ModuleView } from '@teranga/contracts';
import { Card, cn } from '@teranga/ui';
import { dureeLisible, horloge, MOTS_ETAT } from '../lib/academy';
import { compte } from '../lib/mots';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Le programme d'une formation : ses modules, ses leçons, et où l'on en est.

   Chaque module est une carte à part, ouverte par un grand numéro — on lit
   la structure d'un regard avant de lire un seul titre. Dedans, les leçons
   forment un PARCOURS : une pastille par leçon, reliées par un fil qui se
   teinte de vert à mesure qu'on avance. La prochaine leçon se détache ; les
   suivantes attendent derrière leur cadenas.

   L'état de chaque leçon se lit à sa FORME avant sa couleur — coche pour
   une leçon validée, lecture pour celle qui s'ouvre, anneau pour celle
   qu'on a entamée, cadenas pour celles qui attendent. La couleur double le
   signal, elle ne le porte jamais seule.

   Une leçon verrouillée n'est pas un lien : on ne clique pas sur ce qui ne
   s'ouvrira pas. Elle dit pourquoi au survol.
   ———————————————————————————————————————————————————————————————— */

const CHIFFRES = { fontVariantNumeric: 'tabular-nums' } as const;

type Accent = 'validee' | 'prochaine' | 'en_cours' | 'ouverte' | 'verrouillee';

function accentDe(l: LessonView, prochaine: boolean): Accent {
  if (l.etat === 'validee') return 'validee';
  if (l.etat === 'verrouillee') return 'verrouillee';
  // Entamée, la leçon garde son anneau même quand c'est elle qui attend :
  // la part déjà vue est justement ce qu'on veut savoir avant de reprendre.
  if (l.etat === 'en_cours') return 'en_cours';
  if (prochaine) return 'prochaine';
  return 'ouverte';
}

/** La pastille d'une leçon, sur le fil du parcours. */
function Pastille({ accent, vu }: { accent: Accent; vu: number }) {
  if (accent === 'en_cours') {
    // Entamée : un anneau dit la part vue, autour du bouton de lecture.
    const r = 17;
    const tour = 2 * Math.PI * r;
    return (
      <span className="relative grid size-10 place-items-center rounded-full bg-primary-soft text-primary">
        <svg aria-hidden viewBox="0 0 40 40" className="absolute inset-0 -rotate-90">
          <circle cx="20" cy="20" r={r} fill="none" strokeWidth="3" className="stroke-primary/15" />
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className="stroke-primary"
            strokeDasharray={tour}
            strokeDashoffset={tour * (1 - Math.max(0.04, Math.min(1, vu)))}
          />
        </svg>
        <Icon name="play_arrow" size={18} fill />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid size-10 place-items-center rounded-full transition-transform duration-200',
        accent === 'validee' && 'bg-success text-white',
        accent === 'prochaine' &&
          'bg-primary text-primary-ink shadow-[0_6px_16px_-6px_rgb(0_79_145/0.55)] group-hover:scale-105',
        accent === 'ouverte' && 'bg-primary-soft text-primary group-hover:scale-105',
        accent === 'verrouillee' && 'bg-line-soft text-ink-muted/70',
      )}
    >
      <Icon
        name={accent === 'validee' ? 'check' : accent === 'verrouillee' ? 'lock' : 'play_arrow'}
        size={accent === 'verrouillee' ? 16 : 19}
        fill={accent === 'prochaine' || accent === 'ouverte'}
      />
    </span>
  );
}

/** Une étiquette courte à côté du numéro : ce que la leçon attend de vous. */
function Etiquette({
  accent,
  ici,
  prochaine,
  vu,
}: {
  accent: Accent;
  ici: boolean;
  prochaine: boolean;
  vu: number;
}) {
  const forme = 'rounded-full px-2 py-[2px] text-[10.5px] font-bold';
  const doux = cn(forme, 'bg-primary-soft text-primary');
  const part = `${Math.floor(vu * 100)} %`;
  if (ici) return <span className={cn(forme, 'bg-primary text-primary-ink')}>En lecture</span>;
  if (prochaine && accent === 'en_cours') {
    return (
      <span className={doux} style={CHIFFRES}>
        Reprendre · {part}
      </span>
    );
  }
  if (accent === 'prochaine') return <span className={doux}>À suivre</span>;
  if (accent === 'en_cours') {
    return (
      <span className={doux} style={CHIFFRES}>
        Vue à {part}
      </span>
    );
  }
  return null;
}

/** Le support et la durée : à droite sur écran large, sous le titre sur téléphone. */
function Mesures({ lecon: l, compact }: { lecon: LessonView; compact?: boolean }) {
  const pastille =
    'inline-flex items-center gap-1 rounded-full bg-line-soft/70 px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted';
  return (
    <>
      {l.support ? (
        <span className={pastille} title="Support PDF">
          <Icon name="description" size={14} />
          PDF
        </span>
      ) : null}
      {l.durationSeconds ? (
        <span className={pastille} style={CHIFFRES}>
          {compact ? null : <Icon name="schedule" size={13} />}
          {horloge(l.durationSeconds)}
        </span>
      ) : null}
    </>
  );
}

function CarteModule({
  module: m,
  rang,
  premierNumero,
  formation,
  courante,
  prochaine,
}: {
  module: ModuleView;
  rang: number;
  premierNumero: number;
  formation: CourseDetail;
  courante?: string;
  prochaine: string | null;
}) {
  const suivi = formation.mode === 'suivi';
  const validees = m.lessons.filter((l) => l.etat === 'validee').length;
  const complet = suivi && m.lessons.length > 0 && validees === m.lessons.length;
  const duree = m.lessons.reduce((s, l) => s + (l.durationSeconds ?? 0), 0);

  return (
    <Card className="shrink-0 overflow-hidden rounded-[20px]">
      <section aria-labelledby={`module-${m.id}`}>
        {/* ———— L'en-tête : le numéro en grand, le titre, ce qu'il pèse. */}
        <header className="flex items-center gap-4 border-b border-line-soft px-5 py-5 sm:px-7">
          <span
            className={cn(
              'grid size-12 shrink-0 place-items-center rounded-[14px] text-[18px] font-extrabold tracking-[-0.02em]',
              complet ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary',
            )}
            style={CHIFFRES}
            aria-hidden
          >
            {complet ? <Icon name="check" size={24} /> : String(rang).padStart(2, '0')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
              Module {rang}
            </p>
            <h3
              id={`module-${m.id}`}
              className="mt-0.5 text-[17px] leading-snug font-bold tracking-[-0.01em] text-ink-strong"
            >
              {m.title}
            </h3>
          </div>
          <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
            <span className="text-[12.5px] font-semibold text-ink-muted" style={CHIFFRES}>
              {compte(m.lessons.length, 'leçon')} · {dureeLisible(duree)}
            </span>
            {suivi ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-chart-track">
                  <span
                    className={cn(
                      'block h-full rounded-full transition-[width] duration-500',
                      complet ? 'bg-success' : 'bg-primary',
                    )}
                    style={{
                      width: `${m.lessons.length ? (validees / m.lessons.length) * 100 : 0}%`,
                    }}
                  />
                </span>
                <span className="text-[11.5px] font-bold text-ink-muted" style={CHIFFRES}>
                  {validees}/{m.lessons.length}
                </span>
              </span>
            ) : null}
          </div>
        </header>

        {/* ———— Le parcours. */}
        <ol className="px-3 py-3 sm:px-5">
          {m.lessons.map((l, i) => {
            const numero = premierNumero + i;
            const ici = l.id === courante;
            const estProchaine = l.id === prochaine;
            const accent = accentDe(l, estProchaine);
            const verrouillee = accent === 'verrouillee';
            const precedente = m.lessons[i - 1];
            // Le fil se teinte de vert derrière soi : entre deux leçons
            // validées, et sous chaque leçon validée.
            const filHaut = precedente?.etat === 'validee';
            const filBas = l.etat === 'validee';

            const contenu = (
              <>
                {/* La colonne du fil : la pastille, et le trait qui la relie
                    aux leçons voisines, d'un bord à l'autre de la rangée. */}
                <span className="flex w-10 shrink-0 flex-col items-center self-stretch" aria-hidden>
                  <span
                    className={cn(
                      'w-0.5 flex-1',
                      i === 0 ? 'bg-transparent' : filHaut ? 'bg-success/60' : 'bg-line-soft',
                    )}
                  />
                  <Pastille accent={accent} vu={l.vu} />
                  <span
                    className={cn(
                      'w-0.5 flex-1',
                      i === m.lessons.length - 1
                        ? 'bg-transparent'
                        : filBas
                          ? 'bg-success/60'
                          : 'bg-line-soft',
                    )}
                  />
                </span>

                <span className="min-w-0 flex-1 py-4">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[11.5px] font-semibold text-ink-muted" style={CHIFFRES}>
                      Leçon {numero}
                    </span>
                    <Etiquette accent={accent} ici={ici} prochaine={estProchaine} vu={l.vu} />
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block text-[15px] leading-snug',
                      verrouillee ? 'font-semibold text-ink-muted' : 'font-bold text-ink-strong',
                    )}
                  >
                    {l.title}
                  </span>
                  {/* Sur téléphone, sous le titre : à droite, les pastilles
                      écrasaient le titre sur trois ou quatre lignes. */}
                  <span className="mt-2 flex flex-wrap gap-1.5 sm:hidden">
                    <Mesures lecon={l} compact />
                  </span>
                </span>

                <span className="hidden shrink-0 items-center gap-2 py-4 pl-2 sm:flex">
                  <Mesures lecon={l} />
                  {!verrouillee ? (
                    <Icon
                      name="chevron_right"
                      size={20}
                      className="text-ink-muted/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
                    />
                  ) : (
                    <span className="w-5" />
                  )}
                </span>
              </>
            );

            const classes = cn(
              'group flex items-stretch gap-4 rounded-[14px] px-2 sm:px-3',
              ici && 'bg-primary-soft/60',
              estProchaine && !ici && 'bg-primary-soft/35',
            );
            return (
              <li key={l.id}>
                {verrouillee ? (
                  <div
                    title={MOTS_ETAT.verrouillee}
                    aria-disabled
                    className={cn(classes, 'cursor-not-allowed')}
                  >
                    {contenu}
                  </div>
                ) : (
                  <Link
                    href={`/academy/${formation.id}/lecon/${l.id}`}
                    aria-current={ici ? 'step' : undefined}
                    className={cn(
                      classes,
                      'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
                      ici || estProchaine ? 'hover:bg-primary-soft/70' : 'hover:bg-hover',
                    )}
                  >
                    {contenu}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </Card>
  );
}

export function Programme({
  formation,
  courante,
  avancement = false,
}: {
  formation: CourseDetail;
  /** La leçon ouverte à l'écran, quand il y en a une. */
  courante?: string;
  /**
   * Redire l'avancement à côté du titre — sur la page d'une leçon, où rien
   * d'autre ne le dit. La page de la formation l'a déjà sous son titre.
   */
  avancement?: boolean;
}) {
  const suivi = formation.mode === 'suivi';
  // La leçon qui attend l'agent : elle se détache du parcours. Sur la page
  // d'une leçon, c'est la leçon ouverte qui porte l'accent.
  const prochaine = suivi && !courante ? formation.resumeLessonId : null;
  const debuts = formation.modules.reduce<number[]>(
    (acc, _m, i) => [...acc, i === 0 ? 1 : acc[i - 1]! + formation.modules[i - 1]!.lessons.length],
    [],
  );
  const part = formation.lessonCount ? formation.completedLessons / formation.lessonCount : 0;

  return (
    <section aria-label="Programme" className="flex shrink-0 flex-col gap-4">
      <div className="flex items-end justify-between gap-4 px-1 pt-2">
        <h2 className="text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
          Programme
        </h2>
        {avancement && suivi ? (
          <span className="flex items-center gap-3">
            <span className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-chart-track sm:block">
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${part * 100}%` }}
              />
            </span>
            <span className="text-[12.5px] font-semibold text-ink-muted" style={CHIFFRES}>
              {formation.completedLessons}/{formation.lessonCount}{' '}
              {formation.completedLessons > 1 ? 'validées' : 'validée'}
            </span>
          </span>
        ) : null}
      </div>
      {formation.modules.map((m, i) => (
        <CarteModule
          key={m.id}
          module={m}
          rang={i + 1}
          premierNumero={debuts[i]!}
          formation={formation}
          courante={courante}
          prochaine={prochaine}
        />
      ))}
    </section>
  );
}
