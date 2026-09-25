import Link from 'next/link';
import type { AcademyCategory, CourseSummary } from '@teranga/contracts';
import { Badge, CardInteractive, cn } from '@teranga/ui';
import { dureeLisible, FAMILLES } from '../lib/academy';
import { compte } from '../lib/mots';
import { Icon } from './icons';

/* ————————————————————————————————————————————————————————————————
   La couverture d'une formation, et sa carte au catalogue.

   La couverture est DESSINÉE, pas téléversée : la RH n'a pas à chercher une
   image pour chaque formation, et le catalogue ne mélange pas dix styles de
   photos. Une nuance de bleu par famille, son icône en filigrane — de loin,
   on reconnaît la famille ; de près, on lit le titre.
   ———————————————————————————————————————————————————————————————— */

export function Couverture({
  category,
  className,
  children,
}: {
  category: AcademyCategory;
  className?: string;
  children?: React.ReactNode;
}) {
  const famille = FAMILLES[category];
  return (
    <div
      className={cn('relative overflow-hidden text-white', className)}
      style={{ background: famille.degrade }}
    >
      {/* Le filigrane : grand, décalé, presque effacé. Il habille sans
          concurrencer ce qui s'écrit par-dessus. */}
      <Icon
        name={famille.icone}
        size={112}
        className="pointer-events-none absolute -right-3 -bottom-5 opacity-[0.14]"
      />
      {/* Une lumière douce en haut à gauche : sans elle, un dégradé plat
          fait carton. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 0% 0%, rgb(255 255 255 / 0.16) 0%, transparent 55%)',
        }}
      />
      {children}
    </div>
  );
}

/** La progression d'un agent, en barre fine. Rien du tout s'il n'a pas commencé. */
export function BarreProgression({ part, className }: { part: number; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(part * 100)}
      className={cn('h-1.5 overflow-hidden rounded-full bg-chart-track', className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(1, part)) * 100}%` }}
      />
    </div>
  );
}

export function CarteFormation({ formation }: { formation: CourseSummary }) {
  const famille = FAMILLES[formation.category];
  const terminee =
    formation.lessonCount > 0 && formation.completedLessons === formation.lessonCount;
  const commencee = formation.lastActivityAt !== null;
  const part = formation.lessonCount ? formation.completedLessons / formation.lessonCount : 0;

  return (
    <Link
      href={`/academy/${formation.id}`}
      className="group block h-full focus-visible:outline-none"
    >
      <CardInteractive className="flex h-full flex-col overflow-hidden group-focus-visible:ring-2 group-focus-visible:ring-primary/40">
        <Couverture category={formation.category} className="h-[118px] shrink-0">
          <div className="relative flex h-full flex-col justify-between p-4">
            <span className="w-fit rounded-full bg-white/15 px-2.5 py-[3px] text-[10.5px] font-bold tracking-[0.06em] uppercase ring-1 ring-white/20 backdrop-blur-sm">
              {famille.label}
            </span>
            <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-white/85">
              <Icon name="schedule" size={14} />
              {dureeLisible(formation.totalSeconds)}
              <span className="text-white/50">·</span>
              {compte(formation.lessonCount, 'leçon')}
            </span>
          </div>
        </Couverture>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-2 text-[14.5px] leading-snug font-bold tracking-[-0.01em] text-ink-strong">
            {formation.title}
          </h3>
          {formation.summary ? (
            <p className="line-clamp-2 text-[12.5px] leading-relaxed text-ink-muted">
              {formation.summary}
            </p>
          ) : null}

          <div className="mt-auto pt-2">
            {terminee ? (
              <Badge tone="success" className="gap-1">
                <Icon name="check_circle" size={13} fill />
                Terminée
              </Badge>
            ) : commencee ? (
              <div className="flex items-center gap-3">
                <BarreProgression part={part} className="flex-1" />
                <span
                  className="text-[11.5px] font-semibold text-ink-muted"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formation.completedLessons}/{formation.lessonCount}
                </span>
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-primary">
                Découvrir
                <Icon
                  name="arrow_forward"
                  size={14}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </span>
            )}
          </div>
        </div>
      </CardInteractive>
    </Link>
  );
}

/** Le lien de retour, en tête d'écran : vers le catalogue, ou vers la formation. */
export function RetourAcademy({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit max-w-full items-center gap-1 text-[12.5px] font-semibold text-ink-muted transition-colors hover:text-primary"
    >
      <Icon name="chevron_left" size={17} className="shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
