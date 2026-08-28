import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@teranga/ui';
import { Icon } from '../../../components/icons';

export interface PointApplique {
  titre: string;
  detail: string;
  lien?: { href: string; label: string };
}

/**
 * Charpente commune aux trois textes de référence.
 *
 * Chacun se lit de la même façon : ce que le texte gouverne, ce que
 * l'application en applique DÉJÀ — vérifiable, pas promis — et le texte
 * lui-même, qui n'est pas encore déposé. On ne recopie aucun article ici :
 * une citation légale approximative dans un outil RH d'agence publique coûte
 * plus cher que son absence.
 */
export function TexteDeReference({
  intro,
  appliques,
  aVenir,
  depot,
}: {
  intro: string;
  appliques: PointApplique[];
  aVenir?: PointApplique[];
  /**
   * Ce que le dépôt du texte apportera, dit sans le promettre pour demain.
   * Omis quand la rubrique n'attend AUCUN texte : la conformité n'est pas un
   * document à déposer, c'est un état à constater.
   */
  depot?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <p className="text-[13px] leading-relaxed text-ink">{intro}</p>

      {appliques.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Ce que l&apos;application applique déjà</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5">
            {appliques.map((p) => (
              <Point key={p.titre} point={p} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {aVenir && aVenir.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pas encore outillé</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3.5">
            {aVenir.map((p) => (
              <Point key={p.titre} point={p} muted />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {depot ? (
        <Card>
          <CardHeader>
            <CardTitle>Le texte</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={<Icon name="gavel" size={22} />}
              title="Texte non déposé"
              description={depot}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Point({ point, muted = false }: { point: PointApplique; muted?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full ${
          muted ? 'bg-bg text-ink-muted' : 'bg-success-soft text-success'
        }`}
      >
        <Icon name={muted ? 'schedule' : 'check'} size={12} />
      </span>
      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink">
        <span className="font-bold text-ink-strong">{point.titre}</span> — {point.detail}
        {point.lien ? (
          <>
            {' '}
            <Link href={point.lien.href} className="font-semibold text-primary hover:underline">
              {point.lien.label}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
