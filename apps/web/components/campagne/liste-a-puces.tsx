'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { cn } from '@teranga/ui';

/*
   Une réponse en puces (ADR-0238), comme les champs en puces de la grille
   d'évaluation (ADR-0153) : une puce par ligne, toujours une au moins, où
   l'on écrit d'emblée. Entrée ouvre la puce suivante, et ce qui suit le
   curseur y passe ; Retour arrière au début d'une puce la rattache à la
   précédente ; les flèches passent d'une puce à l'autre ; un texte collé sur
   plusieurs lignes donne autant de puces. La réponse s'enregistre en texte,
   une ligne par puce.
*/

/** Le tiret ou la puce qu'un texte collé met en tête de ligne. */
const MARQUE = /^\s*[-•*–]\s+/;

export function ListeAPuces({
  id,
  libelle,
  valeur,
  onChange,
  max,
  autoFocus = false,
}: {
  /** Celui de la première puce, que l'intitulé de la question désigne. */
  id?: string;
  /** La question, pour les lecteurs d'écran. */
  libelle: string;
  valeur: string;
  onChange: (texte: string) => void;
  /** Ce que la réponse peut compter de caractères, sauts de ligne compris. */
  max: number;
  /** Le curseur dans la première puce, dès qu'elle paraît. */
  autoFocus?: boolean;
}) {
  const puces = valeur.split('\n');
  const zones = useRef<(HTMLTextAreaElement | null)[]>([]);
  const composition = useRef(false);
  // Où remettre le curseur une fois la liste redessinée.
  const [curseur, setCurseur] = useState<{ puce: number; position: number } | null>(
    autoFocus ? { puce: 0, position: puces[0]!.length } : null,
  );
  const reste = Math.max(0, max - valeur.length);

  useLayoutEffect(() => {
    if (!curseur) return;
    const zone = zones.current[curseur.puce];
    zone?.focus();
    zone?.setSelectionRange(curseur.position, curseur.position);
    setCurseur(null);
  }, [curseur]);

  // Chaque puce grandit avec son texte, et se remesure quand la page change de largeur.
  const ajuster = useCallback(() => {
    for (const zone of zones.current) {
      if (!zone) continue;
      zone.style.height = 'auto';
      zone.style.height = `${zone.scrollHeight}px`;
    }
  }, []);
  useLayoutEffect(ajuster, [valeur, ajuster]);
  useEffect(() => {
    window.addEventListener('resize', ajuster);
    return () => window.removeEventListener('resize', ajuster);
  }, [ajuster]);

  const ecrire = (suivantes: string[], puce: number, position: number) => {
    onChange(suivantes.join('\n'));
    setCurseur({ puce, position });
  };

  const changer = (i: number) => (e: ChangeEvent<HTMLTextAreaElement>) => {
    // Une puce tient sur sa ligne : un saut de ligne venu d'ailleurs devient une espace.
    const texte = e.target.value.replace(/\r?\n/g, ' ');
    onChange([...puces.slice(0, i), texte, ...puces.slice(i + 1)].join('\n'));
  };

  const touche = (i: number) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (composition.current || e.nativeEvent.isComposing) return;
    const zone = e.currentTarget;
    const debut = zone.selectionStart;
    const fin = zone.selectionEnd;
    const texte = puces[i]!;
    const modifiee = e.altKey || e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !modifiee) {
      e.preventDefault();
      // Une nouvelle puce coûte un caractère, le saut de ligne.
      if (reste < 1 && debut === fin) return;
      const suivantes = [...puces.slice(0, i), texte.slice(0, debut), texte.slice(fin)];
      ecrire([...suivantes, ...puces.slice(i + 1)], i + 1, 0);
    } else if (e.key === 'Backspace' && !modifiee && debut === 0 && fin === 0 && i > 0) {
      e.preventDefault();
      const precedente = puces[i - 1]!;
      ecrire(
        [...puces.slice(0, i - 1), precedente + texte, ...puces.slice(i + 1)],
        i - 1,
        precedente.length,
      );
    } else if (
      e.key === 'Delete' &&
      !modifiee &&
      debut === texte.length &&
      fin === texte.length &&
      i < puces.length - 1
    ) {
      e.preventDefault();
      ecrire([...puces.slice(0, i), texte + puces[i + 1]!, ...puces.slice(i + 2)], i, texte.length);
    } else if (e.key === 'ArrowUp' && debut === 0 && fin === 0 && i > 0) {
      e.preventDefault();
      setCurseur({ puce: i - 1, position: puces[i - 1]!.length });
    } else if (
      e.key === 'ArrowDown' &&
      debut === texte.length &&
      fin === texte.length &&
      i < puces.length - 1
    ) {
      e.preventDefault();
      setCurseur({ puce: i + 1, position: 0 });
    }
  };

  const coller = (i: number) => (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const colle = e.clipboardData.getData('text/plain');
    // Une seule ligne : le navigateur la colle lui-même.
    if (!/\r?\n/.test(colle)) return;
    e.preventDefault();
    const zone = e.currentTarget;
    const texte = puces[i]!;
    const debut = zone.selectionStart;
    const fin = zone.selectionEnd;
    // Les lignes écrites, sans leur tiret ; au-delà de la place qui reste, coupées.
    const place = max - (valeur.length - (fin - debut));
    const lignes = colle
      .split(/\r?\n/)
      .map((l) => l.replace(MARQUE, '').trimEnd())
      .filter((l) => l.trim() !== '')
      .join('\n')
      .slice(0, Math.max(0, place))
      .split('\n');
    const apres = texte.slice(fin);
    const nouvelles = lignes.map((l, k) => (k === 0 ? texte.slice(0, debut) + l : l));
    const derniere = nouvelles.length - 1;
    const position = nouvelles[derniere]!.length;
    nouvelles[derniere] += apres;
    ecrire([...puces.slice(0, i), ...nouvelles, ...puces.slice(i + 1)], i + derniere, position);
  };

  return (
    <div>
      <div
        className={cn(
          'min-h-[58px] w-full rounded-controle border border-line bg-surface px-3 py-2.5',
          'transition-colors duration-150 ease-out',
          'focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary/40',
        )}
      >
        <ul aria-label={libelle} className="flex flex-col gap-1">
          {puces.map((p, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="w-2 shrink-0 text-[15px] leading-5 text-ink-muted select-none"
              >
                •
              </span>
              <textarea
                ref={(zone) => {
                  zones.current[i] = zone;
                }}
                id={i === 0 ? id : undefined}
                aria-label={i === 0 ? undefined : `${libelle} : puce ${i + 1}`}
                rows={1}
                value={p}
                maxLength={p.length + reste}
                onChange={changer(i)}
                onKeyDown={touche(i)}
                onPaste={coller(i)}
                onCompositionStart={() => {
                  composition.current = true;
                }}
                onCompositionEnd={() => {
                  composition.current = false;
                }}
                className="min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-[12.5px] leading-5 text-ink outline-none"
              />
            </li>
          ))}
        </ul>
      </div>
      {valeur.length >= max * 0.8 ? (
        <p className="mt-1 text-right text-[11px] text-ink-muted tabular-nums">
          {valeur.length} / {max}
        </p>
      ) : null}
    </div>
  );
}
