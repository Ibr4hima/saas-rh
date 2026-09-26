import type { BalanceView } from '@teranga/contracts';
import { Card, CardContent, cn } from '@teranga/ui';

const TABULAIRE = { fontVariantNumeric: 'tabular-nums' } as const;

/**
 * Le solde d'un type de congé : le chiffre qui compte, puis la barre qui dit
 * d'où il vient.
 *
 * Trois segments dans une même barre — pris, en attente, restant — parce que
 * « 30 j restants » ne se comprend qu'au regard du droit ouvert. L'orange des
 * jours en attente n'est pas décoratif : c'est la couleur que la charte
 * réserve à CE QUI ATTEND un geste (ici, le visa du responsable), et c'est
 * exactement ce que ces jours sont.
 *
 * Chaque segment porte son libellé écrit juste dessous : la couleur n'est
 * jamais seule à renseigner.
 *
 * La carte est partagée par « Mon espace » et « Mes congés » : le même solde
 * ne doit pas se raconter de deux façons selon l'écran qui le montre.
 */
export function CarteSolde({ solde }: { solde: BalanceView }) {
  const total = Math.max(solde.entitledDays, solde.takenDays + solde.pendingDays);
  const part = (n: number) => (total > 0 ? `${(n / total) * 100}%` : '0%');
  const segments: { n: number; mot: string; teinte: string; pastille: string }[] = [
    { n: solde.takenDays, mot: 'pris', teinte: 'bg-chart', pastille: 'bg-chart' },
    { n: solde.pendingDays, mot: 'en attente', teinte: 'bg-accent', pastille: 'bg-accent' },
    {
      n: Math.max(0, solde.remainingDays),
      mot: 'restants',
      teinte: 'bg-chart-track',
      pastille: 'bg-chart-track',
    },
  ];

  return (
    <Card>
      <CardContent className="px-5 py-[18px]">
        <p className="text-[10px] font-bold tracking-[0.1em] text-ink-muted uppercase">
          {solde.absenceTypeName} {solde.year}
        </p>
        <p className="mt-2 flex items-baseline gap-1.5">
          <span
            className="text-[34px] leading-none font-bold tracking-[-0.025em] text-ink-strong"
            style={TABULAIRE}
          >
            {solde.remainingDays}
          </span>
          <span className="text-[13px] font-medium text-ink-muted">
            jour{solde.remainingDays > 1 ? 's' : ''} restant{solde.remainingDays > 1 ? 's' : ''} sur{' '}
            {solde.entitledDays}
          </span>
        </p>

        {/* Un jour de blanc entre les segments : sans lui, deux teintes
            voisines se lisent comme un seul bloc. */}
        <div className="mt-3.5 flex h-2 gap-[2px]">
          {segments.map((s) =>
            s.n > 0 ? (
              <span
                key={s.mot}
                className={cn('rounded-full', s.teinte)}
                style={{ width: part(s.n) }}
              />
            ) : null,
          )}
        </div>

        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {segments.map((s) => (
            <li key={s.mot} className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', s.pastille)} />
              <span style={TABULAIRE}>
                {s.n} {s.mot}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
