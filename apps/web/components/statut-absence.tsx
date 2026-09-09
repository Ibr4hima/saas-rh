import { cn } from '@teranga/ui';
import { ABSENCE_STATUS_LABELS, ABSENCE_STATUS_TONES } from '../lib/absences';

/**
 * Aplats doux, mesurés : chaque texte tient au moins 4,89:1 sur son fond, de
 * jour comme de nuit. Le halo intérieur donne au tag son arête sans ajouter
 * une couleur de plus — il est tiré de la teinte du texte.
 */
const FONDS: Record<string, string> = {
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-line-soft text-ink-muted',
};

/**
 * Le statut d'une demande d'absence.
 *
 * Une pastille de couleur PUIS le mot : la couleur donne l'état d'un coup
 * d'œil sur vingt lignes, le mot le dit pour qui ne la distingue pas — un
 * daltonien, une impression en noir et blanc. Aucun des deux ne suffit seul.
 */
export function StatutAbsence({
  statut,
  titre,
  className,
}: {
  statut: string;
  /** Le détail du circuit de visa, au survol : niveau par niveau, qui a signé. */
  titre?: string;
  className?: string;
}) {
  const ton = ABSENCE_STATUS_TONES[statut] ?? 'neutral';
  return (
    <span
      title={titre}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full py-[3px] pr-2.5 pl-2 text-[11px] font-semibold whitespace-nowrap ring-1 ring-current/15 ring-inset',
        FONDS[ton] ?? FONDS.neutral,
        className,
      )}
    >
      <span className="size-[5px] shrink-0 rounded-full bg-current" />
      {ABSENCE_STATUS_LABELS[statut] ?? statut}
    </span>
  );
}
