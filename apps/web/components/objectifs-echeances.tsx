'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  dateDEvaluation,
  dateEnLettres,
  OBJECTIF_TEXTE_MAX,
  reglesDesEcheances,
  type JoursEvaluation,
  type ObjectifsFixes,
  type PeriodeObjectifs,
} from '@teranga/contracts';
import { Button, cn, Input } from '@teranga/ui';
import { api, ApiError } from '../lib/api';
import { aujourdhui } from '../lib/temps';
import { Icon } from './icons';
import { Modal, ModalSection } from './modal';
import { CLE_OBJECTIFS } from './objectifs';

/*
   Les objectifs ponctuels, chacun avec son échéance (ADR-0055). Le n+1 ne
   choisit pas le semestre : un objectif compte pour la première évaluation
   qui tombe le jour de son échéance ou après. La règle se lit là où l'on
   fixe une échéance, avec les jours que la DCH a choisis.
*/

/** Le dernier jour où une échéance se fixe : la dernière évaluation de l'année suivante. */
export function horizonDesEcheances(jours: JoursEvaluation): string {
  return dateDEvaluation(Number(aujourdhui().slice(0, 4)) + 1, 2, jours);
}

/**
 * L'échéance d'un objectif : « 20 mars », avec l'année quand ce n'est pas
 * celle de sa fiche.
 */
export function Echeance({
  date,
  annee,
  className,
}: {
  date: string;
  annee: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 text-[11.5px] leading-[18.75px] font-semibold whitespace-nowrap text-ink-muted',
        className,
      )}
    >
      <Icon name="event" size={14} className="opacity-75" />
      <span className="sr-only">Échéance :</span>
      {dateEnLettres(date, Number(date.slice(0, 4)) !== annee)}
    </span>
  );
}

/**
 * L'échéance, à changer : la même puce, et dessous le calendrier du
 * navigateur, qui s'ouvre d'un clic. Au clavier, le champ de date reçoit le
 * focus, et la puce se lit à mesure qu'on tape.
 */
export function ChoixEcheance({
  date,
  annee,
  min,
  max,
  onChange,
  label,
}: {
  date: string;
  annee: number;
  min: string;
  max: string;
  onChange: (date: string) => void;
  label: string;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface py-[3px] pr-2.5 pl-2 text-[11.5px] font-semibold whitespace-nowrap text-ink transition-colors duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30 hover:border-primary/45 hover:text-primary">
      <Icon name="event" size={14} className="opacity-75" />
      {dateEnLettres(date, Number(date.slice(0, 4)) !== annee)}
      <input
        type="date"
        aria-label={label}
        value={date}
        min={min}
        max={max}
        required
        onClick={(e) => {
          try {
            e.currentTarget.showPicker();
          } catch {
            // Un navigateur sans calendrier à ouvrir : la saisie au clavier reste.
          }
        }}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </span>
  );
}

/**
 * La règle, en avertissement, là où l'on fixe une échéance : les jours
 * d'évaluation sont ceux que la DCH a fixés, et changent avec eux.
 */
export function ReglesDesEcheances({
  jours,
  className,
}: {
  jours: JoursEvaluation;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        'flex gap-3 rounded-[12px] bg-primary-soft/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink',
        className,
      )}
    >
      <Icon name="info_i" size={18} className="mt-px shrink-0 text-primary" />
      <ul className="flex list-disc flex-col gap-0.5 pl-4 marker:text-primary/60">
        {reglesDesEcheances(jours).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

/** Une ligne de la fenêtre : un objectif et son échéance. */
interface Ligne {
  cle: number;
  texte: string;
  echeance: string;
}

/**
 * « Fixer des objectifs » : une ligne par objectif, chacun avec son
 * échéance. Pas de semestre à choisir : le serveur range chaque objectif
 * dans l'évaluation où son échéance le fait compter, et dit lesquelles ont
 * reçu quelque chose.
 */
export function FenetreFixerObjectifs({
  employeeId,
  jours,
  onFixes,
  onClose,
}: {
  employeeId: string;
  jours: JoursEvaluation;
  /** Les fiches qui ont reçu les objectifs : la page peut aller les montrer. */
  onFixes: (periodes: PeriodeObjectifs[]) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const suivante = useRef(1);
  const [lignes, setLignes] = useState<Ligne[]>([{ cle: 0, texte: '', echeance: '' }]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const uid = useId();
  const idDe = (cle: number) => `${uid}-objectif-${cle}`;
  const viser = (cle: number) =>
    requestAnimationFrame(() => document.getElementById(idDe(cle))?.focus());
  const min = aujourdhui();
  const max = horizonDesEcheances(jours);

  const changer = (cle: number, quoi: Partial<Ligne>) =>
    setLignes((ls) => ls.map((l) => (l.cle === cle ? { ...l, ...quoi } : l)));

  /** Une ligne de plus sous `apres`, avec la même échéance : on fixe souvent par lots. */
  const ajouter = (apres?: Ligne) => {
    const cle = suivante.current++;
    setLignes((ls) => {
      const i = apres ? ls.findIndex((l) => l.cle === apres.cle) : ls.length - 1;
      const echeance = (apres ?? ls[ls.length - 1])?.echeance ?? '';
      return [...ls.slice(0, i + 1), { cle, texte: '', echeance }, ...ls.slice(i + 1)];
    });
    viser(cle);
  };

  const retirer = (l: Ligne) => {
    const i = lignes.findIndex((x) => x.cle === l.cle);
    const voisine = lignes[i - 1] ?? lignes[i + 1];
    setLignes((ls) => ls.filter((x) => x.cle !== l.cle));
    if (voisine) viser(voisine.cle);
  };

  const auClavier = (e: KeyboardEvent<HTMLInputElement>, l: Ligne) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (l.texte.trim()) ajouter(l);
      return;
    }
    // Une ligne vide s'efface au retour arrière, la précédente reprend la main.
    if (e.key === 'Backspace' && !l.texte && lignes.length > 1) {
      e.preventDefault();
      retirer(l);
    }
  };

  const remplies = lignes.filter((l) => l.texte.trim());
  const sansEcheance = remplies.some((l) => !l.echeance);

  const fixer = async () => {
    if (remplies.length === 0 || sansEcheance || envoi) return;
    setErreur(null);
    setEnvoi(true);
    try {
      const r = await api<ObjectifsFixes>(`/objectifs/equipe/${employeeId}/objectifs`, {
        method: 'POST',
        body: { objectifs: remplies.map((l) => ({ texte: l.texte.trim(), echeance: l.echeance })) },
      });
      await queryClient.invalidateQueries({ queryKey: [...CLE_OBJECTIFS, 'equipe', employeeId] });
      onFixes(r.periodes);
      onClose();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Objectifs non fixés, réessayez.');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Fixer des objectifs"
      maxWidth="max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            loading={envoi}
            disabled={remplies.length === 0 || sansEcheance}
            onClick={() => void fixer()}
          >
            Fixer
          </Button>
        </>
      }
    >
      <ReglesDesEcheances jours={jours} />
      {erreur ? (
        <p
          role="alert"
          className="rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
        >
          {erreur}
        </p>
      ) : null}
      <ModalSection title="Objectifs">
        <ol className="flex flex-col gap-3 max-sm:gap-4">
          {lignes.map((l, i) => (
            <li
              key={l.cle}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]"
            >
              <Input
                id={idDe(l.cle)}
                aria-label={`Objectif ${i + 1}`}
                placeholder="Objectif"
                maxLength={OBJECTIF_TEXTE_MAX}
                value={l.texte}
                onChange={(e) => changer(l.cle, { texte: e.target.value })}
                onKeyDown={(e) => auClavier(e, l)}
                className="max-sm:col-span-2"
              />
              <Input
                type="date"
                aria-label={`Échéance de l’objectif ${i + 1}`}
                min={min}
                max={max}
                value={l.echeance}
                onChange={(e) => changer(l.cle, { echeance: e.target.value })}
                className="tabular-nums"
              />
              <button
                type="button"
                aria-label={`Retirer l’objectif ${i + 1}`}
                title="Retirer"
                disabled={lignes.length === 1}
                onClick={() => retirer(l)}
                className="grid size-10 place-items-center rounded-full text-ink-muted transition-colors duration-150 outline-none hover:bg-hover hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/35 disabled:pointer-events-none disabled:opacity-30"
              >
                <Icon name="close" size={18} />
              </button>
            </li>
          ))}
        </ol>
        <Button variant="ghost" size="sm" className="mt-3 -ml-2" onClick={() => ajouter()}>
          <Icon name="add" size={16} />
          Ajouter un objectif
        </Button>
      </ModalSection>
    </Modal>
  );
}
