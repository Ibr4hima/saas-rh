import { numerosDesBlocs, type TexteRiche } from '@teranga/contracts';
import { cn } from '@teranga/ui';

/*
   Un texte mis en forme (ADR-0150), en lecture : chaque bloc sur sa ligne,
   les listes en retrait, leur puce ou leur numéro dans la marge, comme
   l'éditeur les montre et comme le PDF les imprime. Sans BlockNote : la
   page qui ne fait que lire ne le charge pas.
*/

/** La puce de chaque niveau, celle de l'éditeur. */
const PUCES = ['•', '◦', '▪'] as const;

export function TexteRicheLu({ texte, className }: { texte: TexteRiche; className?: string }) {
  const numeros = numerosDesBlocs(texte);
  return (
    <div
      className={cn(
        'flex flex-col text-[12.5px] leading-relaxed break-words text-ink-strong',
        className,
      )}
    >
      {texte.map((b, i) => {
        const marque =
          b.type === 'puce' ? PUCES[b.niveau] : b.type === 'numero' ? `${numeros[i]}.` : null;
        return (
          <p key={i} className="flex" style={{ paddingLeft: `${b.niveau * 1.125}rem` }}>
            {marque ? <span className="min-w-5 shrink-0 pr-1 text-ink-muted">{marque}</span> : null}
            <span className="min-w-0 flex-1">
              {b.segments.length === 0 ? <br /> : null}
              {b.segments.map((s, j) => (
                <span key={j} className={cn(s.gras && 'font-bold', s.italique && 'italic')}>
                  {s.texte}
                </span>
              ))}
            </span>
          </p>
        );
      })}
    </div>
  );
}
