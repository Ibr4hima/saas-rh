import Link from 'next/link';
import type { CourseDetail, LessonView } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { horloge, MOTS_ETAT } from '../lib/academy';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   Le programme d'une formation : ses modules, ses leçons, et où l'on en est.

   L'état de chaque leçon se lit à son ICÔNE avant de se lire à sa couleur —
   coche pleine pour une leçon validée, lecture pour celle qu'on suit,
   cadenas pour celles qui attendent. La couleur double le signal, elle ne le
   porte jamais seule.

   Une leçon verrouillée n'est pas un lien : on ne clique pas sur ce qui ne
   s'ouvrira pas. Elle dit pourquoi au survol.
   ———————————————————————————————————————————————————————————————— */

function IconeEtat({ lecon, courante }: { lecon: LessonView; courante: boolean }) {
  if (lecon.etat === 'validee') {
    return <Icon name="check_circle" size={18} fill className="text-success" />;
  }
  if (lecon.etat === 'verrouillee') {
    return <Icon name="lock" size={16} className="text-ink-muted/70" />;
  }
  return (
    <Icon
      name="play_circle"
      size={18}
      fill={courante}
      className={courante ? 'text-primary' : 'text-primary/80'}
    />
  );
}

export function Programme({
  formation,
  courante,
  compact = false,
}: {
  formation: CourseDetail;
  /** La leçon ouverte à l'écran, quand il y en a une. */
  courante?: string;
  compact?: boolean;
}) {
  let numero = 0;
  return (
    <div className="flex flex-col gap-4">
      {formation.modules.map((m, i) => (
        <section key={m.id} aria-labelledby={`module-${m.id}`}>
          <h3
            id={`module-${m.id}`}
            className="mb-1.5 flex items-baseline gap-2 px-1 text-[11px] font-extrabold tracking-[0.12em] text-ink-muted uppercase"
          >
            <span className="text-primary">Module {i + 1}</span>
            <span className="min-w-0 truncate normal-case tracking-normal text-[12.5px] font-bold text-ink-strong">
              {m.title}
            </span>
          </h3>
          <ol className="flex flex-col">
            {m.lessons.map((l) => {
              numero += 1;
              const ici = l.id === courante;
              const verrouillee = l.etat === 'verrouillee';
              const contenu = (
                <>
                  <IconeEtat lecon={l} courante={ici} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-[12.5px] leading-snug',
                        ici ? 'font-bold text-ink-strong' : 'font-semibold',
                        verrouillee ? 'text-ink-muted' : !ici && 'text-ink',
                      )}
                    >
                      <span
                        className="mr-1.5 text-ink-muted"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {numero}.
                      </span>
                      {l.title}
                    </span>
                    {!compact && l.etat === 'en_cours' ? (
                      <span className="mt-0.5 block text-[11px] text-ink-muted">
                        Vue à {Math.floor(l.vu * 100)} %
                      </span>
                    ) : null}
                  </span>
                  {l.support && !compact ? (
                    <Icon
                      name="description"
                      size={15}
                      className="shrink-0 text-ink-muted/70"
                      aria-label="Support PDF"
                    />
                  ) : null}
                  {l.durationSeconds ? (
                    <span
                      className="shrink-0 text-[11.5px] text-ink-muted"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {horloge(l.durationSeconds)}
                    </span>
                  ) : null}
                </>
              );
              const classes = cn(
                'flex items-center gap-3 rounded-[10px] px-2.5',
                compact ? 'py-2' : 'py-2.5',
                ici && 'bg-primary-soft/70',
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
                        'transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
                        ici && 'hover:bg-primary-soft',
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
      ))}
    </div>
  );
}
