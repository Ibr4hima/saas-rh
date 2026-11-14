'use client';

import { useEffect, useRef, useState } from 'react';
import { ribGroupe } from '@teranga/contracts';
import { Button, cn, Field, Input } from '@teranga/ui';
import { champDeChiffres } from '../lib/chiffres';

/*
   Le RIB, saisi deux fois comme un mot de passe, partout où il se saisit :
   la domiciliation bancaire (ADR-0174) et la fiche d'un agent (ADR-0202).
   « SN » est déjà écrit, les chiffres se groupent à la frappe comme sur le
   relevé (« SN012 01001 036123456789 54 »). « Valider » masque le premier
   et ouvre le second, qui se tape : coller y est refusé, pour qu'une erreur
   de la première saisie ne s'y recopie pas. « Modifier » rouvre le premier
   et vide le second. Incomplet, un champ passe en rouge, sans message ;
   deux saisies qui diffèrent le disent.
*/

/** Un RIB : « SN », déjà écrit, puis vingt-deux chiffres. */
export const CHIFFRES_DU_RIB = 22;

/** Le RIB tel qu'il se saisit : deux fois, la première masquée une fois validée. */
export interface SaisieDuRib {
  /** Les chiffres après « SN », à la première saisie. */
  rib: string;
  /** La première saisie validée, et masquée. */
  ribValide: boolean;
  /** La seconde saisie, qui doit être la même. */
  confirmation: string;
}

export const RIB_VIDE: SaisieDuRib = { rib: '', ribValide: false, confirmation: '' };

/** Un RIB déjà enregistré : il arrive validé et confirmé, sans se retaper. */
export function ribEnregistre(rib: string | null | undefined): SaisieDuRib {
  const chiffres = (rib ?? '').replace(/^SN/i, '').replace(/\D/g, '');
  return chiffres ? { rib: chiffres, ribValide: true, confirmation: chiffres } : RIB_VIDE;
}

/** Le RIB à enregistrer, saisi deux fois à l'identique ; null tant qu'il ne l'est pas. */
export function ribSaisi(s: SaisieDuRib): string | null {
  return s.ribValide && s.rib.length === CHIFFRES_DU_RIB && s.confirmation === s.rib
    ? `SN${s.rib}`
    : null;
}

/** Une saisie commencée, pas encore confirmée : elle retient l'enregistrement. */
export const ribEnCours = (s: SaisieDuRib): boolean => s.rib.length > 0 && ribSaisi(s) === null;

export function ChampsDuRib({
  id,
  rib,
  valide,
  confirmation,
  requis = true,
  classeDuChamp,
  classeDuBouton = 'h-9',
  onSaisir,
}: {
  id: string;
  rib: string;
  valide: boolean;
  confirmation: string;
  /** Les deux champs portent l'astérisque : le RIB est attendu. */
  requis?: boolean;
  /** La hauteur et le texte des champs, ceux de la page qui les accueille. */
  classeDuChamp?: string;
  /** La hauteur du bouton, celle des champs. */
  classeDuBouton?: string;
  onSaisir: (champ: Partial<SaisieDuRib>) => void;
}) {
  const premier = useRef<HTMLInputElement>(null);
  const second = useRef<HTMLInputElement>(null);
  // Le champ à rejoindre une fois la page repeinte : le second s'ouvre à la
  // validation, le premier à la modification.
  const aRejoindre = useRef<'premier' | 'second' | null>(null);
  useEffect(() => {
    if (aRejoindre.current) (aRejoindre.current === 'second' ? second : premier).current?.focus();
    aRejoindre.current = null;
  });
  const [signale, setSignale] = useState(false);
  const [secondQuitte, setSecondQuitte] = useState(false);

  const incomplet = signale && !valide && rib.length < CHIFFRES_DU_RIB;
  const differe = valide && confirmation.length === CHIFFRES_DU_RIB && confirmation !== rib;
  const secondIncomplet =
    secondQuitte && confirmation.length > 0 && confirmation.length < CHIFFRES_DU_RIB;

  const valider = () => {
    if (rib.length < CHIFFRES_DU_RIB) {
      setSignale(true);
      return;
    }
    aRejoindre.current = 'second';
    onSaisir({ ribValide: true });
  };
  const modifier = () => {
    aRejoindre.current = 'premier';
    setSecondQuitte(false);
    onSaisir({ ribValide: false, confirmation: '' });
  };
  const chiffres = (saisis: string, poser: (c: string) => void) =>
    champDeChiffres({
      chiffres: saisis,
      max: CHIFFRES_DU_RIB,
      grouper: (c) => ribGroupe(`SN${c}`),
      onSaisir: poser,
    });

  return (
    <>
      <Field label="RIB" htmlFor={`${id}-rib`} required={requis}>
        <div className="flex gap-2">
          {valide ? (
            <Input
              ref={premier}
              id={`${id}-rib`}
              readOnly
              value={ribGroupe(`SN${'•'.repeat(rib.length)}`)}
              className={cn(classeDuChamp, 'min-w-0 flex-1 tabular-nums')}
            />
          ) : (
            <Input
              {...chiffres(rib, (c) => onSaisir({ rib: c }))}
              ref={premier}
              id={`${id}-rib`}
              autoComplete="off"
              aria-invalid={incomplet || undefined}
              onBlur={() => {
                if (rib.length > 0) setSignale(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  valider();
                }
              }}
              className={cn(
                classeDuChamp,
                'min-w-0 flex-1 tabular-nums',
                incomplet && 'border-danger',
              )}
            />
          )}
          <Button
            variant="secondary"
            onClick={valide ? modifier : valider}
            className={cn(classeDuBouton, 'shrink-0')}
          >
            {valide ? 'Modifier' : 'Valider'}
          </Button>
        </div>
      </Field>
      <Field
        label="Confirmation du RIB"
        htmlFor={`${id}-confirmation`}
        required={requis}
        error={differe ? 'Les deux RIB ne correspondent pas' : undefined}
      >
        <Input
          {...chiffres(confirmation, (c) => onSaisir({ confirmation: c }))}
          ref={second}
          id={`${id}-confirmation`}
          disabled={!valide}
          autoComplete="off"
          aria-invalid={differe || secondIncomplet || undefined}
          // Le second RIB se tape : rien ne s'y colle ni ne s'y dépose.
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          onBlur={() => setSecondQuitte(true)}
          className={cn(
            classeDuChamp,
            'tabular-nums',
            (differe || secondIncomplet) && 'border-danger',
          )}
        />
      </Field>
    </>
  );
}
