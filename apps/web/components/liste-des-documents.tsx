'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DocumentDeLaListe } from '@teranga/contracts';
import { Card, CardTitle, Case, cn } from '@teranga/ui';
import { Icon } from './icons';

/*
   La liste des documents de la DCH, telle que « Générer des documents » et
   « Demander un document » la montrent : en cinq familles, aux libellés
   courts, dans une liste déroulante à la hauteur bornée (ADR-0111,
   ADR-0112, ADR-0113). On choisit un document pour le générer ; on en coche
   un ou plusieurs pour les demander.
*/

/** Les familles de la liste, dans leur ordre (ADR-0112). */
const FAMILLES_DE_LA_LISTE = [
  'Documents contractuels',
  'Attestations',
  'Documents de rémunération',
  'Situation administrative du personnel',
  'Fin de relation professionnelle',
] as const;
type Famille = (typeof FAMILLES_DE_LA_LISTE)[number];

/**
 * Chaque document de la liste, avec sa famille et son libellé, dans l'ordre
 * où la liste les montre. Le libellé est plus court que le titre : la
 * famille dit déjà de quoi il s'agit, et le document garde son titre
 * (ADR-0111). La table est typée sur la liste de la DCH : un document qui y
 * entre demande sa ligne ici.
 */
export const LIGNES: Record<DocumentDeLaListe, { famille: Famille; libelle: string }> = {
  contrat_cdd: { famille: 'Documents contractuels', libelle: 'Contrat à durée déterminée' },
  contrat_cdi: { famille: 'Documents contractuels', libelle: 'Contrat à durée indéterminée' },
  contrat_stage: { famille: 'Documents contractuels', libelle: 'Contrat de stage' },
  attestation_conge: { famille: 'Attestations', libelle: 'Attestation de congé' },
  attestation_travail: { famille: 'Attestations', libelle: 'Attestation de travail' },
  attestation_reprise_service: {
    famille: 'Attestations',
    libelle: 'Reprise de service · Maternité',
  },
  attestation_reprise_disponibilite: {
    famille: 'Attestations',
    libelle: 'Reprise après disponibilité',
  },
  attestation_depart_retraite: { famille: 'Attestations', libelle: 'Départ à la retraite' },
  attestation_stage: { famille: 'Attestations', libelle: 'Attestation de stage' },
  attestation_cessation: {
    famille: 'Attestations',
    libelle: 'Cessation de paiement et d’activités',
  },
  domiciliation_bancaire: {
    famille: 'Documents de rémunération',
    libelle: 'Domiciliation bancaire',
  },
  attestation_revenu: { famille: 'Documents de rémunération', libelle: 'Attestation de revenu' },
  decision_disponibilite: {
    famille: 'Situation administrative du personnel',
    libelle: 'Mise en disponibilité',
  },
  decision_renouvellement_disponibilite: {
    famille: 'Situation administrative du personnel',
    libelle: 'Renouvellement de disponibilité',
  },
  declaration_mouvement: {
    famille: 'Situation administrative du personnel',
    libelle: 'Déclaration de mouvement du travailleur',
  },
  certificat_travail: {
    famille: 'Fin de relation professionnelle',
    libelle: 'Certificat de travail',
  },
};

/** Les documents dans l'ordre où la liste les montre. */
export const DANS_L_ORDRE = Object.keys(LIGNES) as DocumentDeLaListe[];

const FAMILLES: readonly { titre: Famille; documents: readonly DocumentDeLaListe[] }[] =
  FAMILLES_DE_LA_LISTE.map((titre) => ({
    titre,
    documents: DANS_L_ORDRE.filter((d) => LIGNES[d].famille === titre),
  }));

/** Le cadre des listes déroulantes de ces pages, celui de « Déléguer des tâches ». */
export const CHAMP =
  'h-9 w-full rounded-controle border bg-surface text-[12.5px] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none';
export const MENU =
  'tg-menu absolute top-full right-0 left-0 z-30 mt-1.5 overflow-hidden rounded-bloc border border-card-line bg-surface shadow-lg';
/**
 * Ce qui défile dans le panneau : une hauteur bornée, sept ou huit lignes, et
 * jamais plus que l'écran. La barre de défilement longe le bord du panneau,
 * les lignes gardent leur marge.
 */
export const DEFILEMENT = 'overflow-y-auto overscroll-contain scroll-py-1.5 p-1.5';

/**
 * Un bloc de la page : son intitulé à gauche, ce qu'on y choisit à droite ;
 * dessous, sous un filet, ce qui suit le choix.
 */
export function Etape({
  titre,
  children,
  pied,
}: {
  titre: string;
  children: ReactNode;
  pied?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
        <CardTitle className="min-w-0 flex-1">{titre}</CardTitle>
        <div className="w-full sm:w-[23rem] sm:shrink-0">{children}</div>
      </div>
      {pied ? <div className="border-t border-line-soft">{pied}</div> : null}
    </Card>
  );
}

/**
 * Les documents de la liste, dans une liste déroulante, par familles.
 *
 * Un seul se choisit, et se coche à droite, comme dans les autres listes ; la
 * liste se referme sur son choix. À plusieurs, chacun se coche dans sa case
 * et la liste reste ouverte pour le suivant, comme dans les listes à choix
 * multiples. Un document qui ne se choisit pas dit pourquoi : « À venir »,
 * « En cours ».
 */
export function ListeDesDocuments({
  libelle,
  invite,
  documents = DANS_L_ORDRE,
  choisis,
  multiple = false,
  resume,
  mention,
  onChoisir,
  disabled = false,
}: {
  /** Ce que la liste choisit, pour les lecteurs d'écran : « Document à générer ». */
  libelle: string;
  /** Le bouton quand rien n'est choisi : « Choisir un document ». */
  invite: string;
  /** Ce que la liste montre : tous les documents, sauf à en restreindre. */
  documents?: readonly DocumentDeLaListe[];
  choisis: readonly DocumentDeLaListe[];
  /** Plusieurs documents : chacun se coche, et la liste reste ouverte. */
  multiple?: boolean;
  /** Le bouton à partir de trois documents cochés : « 3 documents ». */
  resume?: (n: number) => string;
  /** Pourquoi un document ne se choisit pas, ou rien s'il se choisit. */
  mention?: (d: DocumentDeLaListe) => string | null;
  /** Un seul : le document choisi. Plusieurs : le document coché ou décoché. */
  onChoisir: (d: DocumentDeLaListe) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [courant, setCourant] = useState<DocumentDeLaListe | null>(null);
  // Les familles qui ont un document à montrer ; une famille vide ne se montre pas.
  const familles = FAMILLES.map((f) => ({
    ...f,
    documents: f.documents.filter((d) => documents.includes(d)),
  })).filter((f) => f.documents.length > 0);
  // Ceux qui se choisissent, dans l'ordre de la liste : le clavier passe de l'un à l'autre.
  const ouvrables = familles.flatMap((f) => f.documents).filter((d) => !mention?.(d));
  const retenus = DANS_L_ORDRE.filter((d) => choisis.includes(d));
  const fermer = () => setOuvert(false);
  // Un clic hors de la liste la referme.
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: PointerEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('pointerdown', auClic);
    return () => document.removeEventListener('pointerdown', auClic);
  }, [ouvert]);

  const ouvrir = () => {
    setCourant(retenus.find((d) => ouvrables.includes(d)) ?? ouvrables[0] ?? null);
    setOuvert(true);
  };
  const choisir = (d: DocumentDeLaListe) => {
    onChoisir(d);
    if (!multiple) {
      setOuvert(false);
      bouton.current?.focus();
    }
  };
  const deplacer = (vers: 'suivant' | 'precedent' | 'premier' | 'dernier') => {
    const i = courant ? ouvrables.indexOf(courant) : -1;
    const cible =
      vers === 'premier'
        ? 0
        : vers === 'dernier'
          ? ouvrables.length - 1
          : vers === 'suivant'
            ? Math.min(i + 1, ouvrables.length - 1)
            : Math.max(i - 1, 0);
    setCourant(ouvrables[cible] ?? null);
  };

  // Au clavier, la ligne désignée reste en vue.
  useEffect(() => {
    if (ouvert && courant) {
      document.getElementById(`${id}-${courant}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [id, ouvert, courant]);

  const texte =
    retenus.length === 0
      ? invite
      : retenus.length > 2 && resume
        ? resume(retenus.length)
        : retenus.map((d) => LIGNES[d].libelle).join(', ');

  return (
    <div ref={racine} className="relative">
      <button
        ref={bouton}
        type="button"
        role="combobox"
        aria-label={libelle}
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={`${id}-liste`}
        aria-activedescendant={ouvert && courant ? `${id}-${courant}` : undefined}
        disabled={disabled}
        onClick={() => (ouvert ? fermer() : ouvrir())}
        onKeyDown={(e) => {
          const touches: Record<string, () => void> = {
            ArrowDown: () => (ouvert ? deplacer('suivant') : ouvrir()),
            ArrowUp: () => (ouvert ? deplacer('precedent') : ouvrir()),
            Home: () => ouvert && deplacer('premier'),
            End: () => ouvert && deplacer('dernier'),
            Enter: () => (ouvert && courant ? choisir(courant) : ouvrir()),
            ' ': () => (ouvert && courant ? choisir(courant) : ouvrir()),
            Escape: fermer,
          };
          const geste = touches[e.key];
          if (geste) {
            e.preventDefault();
            geste();
          } else if (e.key === 'Tab') {
            fermer();
          }
        }}
        className={cn(
          CHAMP,
          'flex items-center gap-2 pr-2 pl-3 text-left disabled:cursor-not-allowed disabled:opacity-50',
          ouvert ? 'border-primary' : 'border-line enabled:hover:border-ink-muted/40',
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            retenus.length > 0 ? 'font-medium text-ink-strong' : 'text-ink-muted',
          )}
        >
          {texte}
        </span>
        <Icon
          name="chevron_right"
          size={16}
          className={cn(
            'shrink-0 text-ink-muted transition-transform duration-150',
            ouvert ? '-rotate-90' : 'rotate-90',
          )}
        />
      </button>

      {ouvert ? (
        <div className={MENU}>
          <div
            id={`${id}-liste`}
            role="listbox"
            aria-label={libelle}
            aria-multiselectable={multiple || undefined}
            className={cn(DEFILEMENT, 'max-h-[min(20rem,calc(100dvh_-_12rem))]')}
          >
            {familles.map((f, rang) => (
              <div
                key={f.titre}
                role="group"
                aria-labelledby={`${id}-famille-${rang}`}
                className={cn(rang > 0 && 'mt-1.5 border-t border-line-soft pt-1.5')}
              >
                <p
                  id={`${id}-famille-${rang}`}
                  className="px-3 pt-1.5 pb-1 text-[10.5px] font-bold tracking-[0.08em] text-ink-muted uppercase"
                >
                  {f.titre}
                </p>
                {f.documents.map((d) => {
                  const raison = mention?.(d) ?? null;
                  const coche = choisis.includes(d);
                  return raison ? (
                    <div
                      key={d}
                      role="option"
                      aria-selected={false}
                      aria-disabled
                      className="flex cursor-not-allowed items-center gap-2.5 rounded-controle-sm px-3 py-[7px] text-[13px] leading-snug text-ink-muted/60"
                    >
                      {multiple ? (
                        <span className="opacity-60">
                          <Case coche={false} />
                        </span>
                      ) : null}
                      <span className="min-w-0 flex-1">{LIGNES[d].libelle}</span>
                      <span className="shrink-0 text-[10.5px] whitespace-nowrap">{raison}</span>
                    </div>
                  ) : (
                    <div
                      key={d}
                      id={`${id}-${d}`}
                      role="option"
                      aria-selected={coche}
                      // Le bouton garde le focus : la liste se ferme sur son départ.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setCourant(d)}
                      onClick={() => choisir(d)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-controle-sm px-3 py-[7px] text-[13px] leading-snug transition-colors duration-150',
                        d === courant && 'bg-hover',
                        !coche
                          ? 'text-ink'
                          : multiple
                            ? 'font-semibold text-ink-strong'
                            : 'font-semibold text-primary',
                      )}
                    >
                      {multiple ? <Case coche={coche} /> : null}
                      <span className="min-w-0 flex-1">{LIGNES[d].libelle}</span>
                      {!multiple && coche ? (
                        <Icon name="check" size={16} className="shrink-0 text-primary" />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
