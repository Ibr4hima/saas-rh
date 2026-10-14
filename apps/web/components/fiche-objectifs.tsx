'use client';

// Sa feuille de style (@blocknote/mantine/style.css) est importée par les
// pages qui l'affichent : chargé à la demande, l'éditeur ne la porte pas.
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { fr } from '@blocknote/core/locales';
import { BlockNoteView } from '@blocknote/mantine';
import {
  FormattingToolbar,
  FormattingToolbarController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useEditorState,
} from '@blocknote/react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  echeanceDuBloc,
  echeancesDeLAnnee,
  OBJECTIF_TEXTE_MAX,
  type FormationDeLaFiche,
  type FormationProposable,
  type StatutObjectif,
} from '@teranga/contracts';
import { Button, cn } from '@teranga/ui';
import { aujourdhui } from '../lib/temps';
import { Case } from './evaluation-objectifs';
import { Icon, type IconName } from './icons';
import { ChoixEcheance, Echeance } from './objectifs-echeances';
import { usePreferences } from './preferences';

/*
   La fiche d'objectifs d'une année, en trois parties. Le titre n'est pas à
   écrire : la page le pose (« Objectifs de l’année 2026 »).

   1. Les OBJECTIFS : une liste, de la plus proche échéance à la plus
      lointaine, ceux sans échéance à la fin. Du texte simple, sur une ligne.
      L'échéance est facultative : elle se choisit dans l'année, au plus tard
      le jour de l'évaluation ; sans elle, l'objectif vaut pour l'année
      (ADR-0075).
   2. Les FORMATIONS À SUIVRE : le catalogue de l'APIX Academy, sans ce que
      l'agent a obtenu ni ce que l'agent encadre (anime, ou gère sans pouvoir
      en passer l'évaluation). Cocher une formation la demande, sans
      échéance : elle s'évalue avec les objectifs de l'année.
   3. Les COMMENTAIRES : un texte libre sur les objectifs fixés (gras,
      italique, souligné, listes, citations), sans case à cocher.

   Les trois parties tiennent dans un seul contenu, dans cet ordre : les
   cases, puis les blocs « formation », puis les blocs du commentaire. Le
   type d'un bloc dit sa partie ; une fiche rédigée avant ce partage s'y
   range à l'ouverture (ses paragraphes et ses puces deviennent le
   commentaire, ses échéances du texte).

   Le n+1 rédige ; l'agent lit la même fiche, sans rien pouvoir y changer.
*/

type Bloc = Record<string, unknown> & {
  id?: string;
  type?: unknown;
  props?: unknown;
  content?: unknown;
  children?: unknown;
};

function dateLisible(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Le texte d'un contenu, sans mise en forme : un lien donne son texte, une échéance sa date. */
function texteDe(contenu: unknown): string {
  if (!Array.isArray(contenu)) return '';
  return (contenu as Bloc[])
    .map((c) => {
      if (c.type === 'text') return String(c.text ?? '');
      if (c.type === 'link') return texteDe(c.content);
      if (c.type === 'echeance') {
        const date = String((c.props as { date?: unknown } | undefined)?.date ?? '');
        return date ? dateLisible(date) : '';
      }
      return '';
    })
    .join('');
}

/** Un contenu où l'on a écrit quelque chose, à quelque profondeur que ce soit. */
const aDuTexte = (blocs: unknown) => /"text":"\s*[^"\s]/.test(JSON.stringify(blocs));

/** Un objectif de la fiche : son texte nu, et son échéance. */
interface Objectif {
  id: string;
  texte: string;
  /** `null` : pas d'échéance, l'objectif vaut pour l'année. */
  echeance: string | null;
}

/** Un objectif : une case, son texte seul, son échéance s'il en a une. */
function enObjectif(b: Bloc): Objectif {
  return {
    id: typeof b.id === 'string' && b.id ? b.id : crypto.randomUUID(),
    texte: texteDe(b.content).replace(/\s+/g, ' ').trim(),
    echeance: echeanceDuBloc(b),
  };
}

/** L'objectif tel qu'il s'enregistre : le serveur le range, et le trie par échéance. */
function enCase(o: Objectif): Bloc {
  return {
    id: o.id,
    type: 'checkListItem',
    props: o.echeance ? { echeance: o.echeance } : {},
    content: [{ type: 'text', text: o.texte.replace(/\s+/g, ' ').trim(), styles: {} }],
    children: [],
  };
}

/**
 * Les objectifs par échéance, de la plus proche à la plus lointaine ; à
 * échéance égale, dans leur ordre. Ceux sans échéance restent en bas.
 */
function parEcheance(objectifs: Objectif[]): Objectif[] {
  const cle = (o: Objectif) => o.echeance ?? '9999-12-31';
  return [...objectifs].sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
}

/** Les blocs que le commentaire connaît : tout, sauf la case à cocher. */
const BLOCS_DU_COMMENTAIRE = new Set([
  'paragraph',
  'bulletListItem',
  'numberedListItem',
  'toggleListItem',
  'quote',
  'table',
  'divider',
]);

/**
 * Un bloc du commentaire. Un titre, d'un temps où l'éditeur en avait, devient
 * un paragraphe en gras ; une échéance, sa date en texte.
 */
function enCommentaire(b: Bloc, enfants: Bloc[]): Bloc {
  const titre = b.type === 'heading';
  const enLigne = Array.isArray(b.content)
    ? (b.content as Bloc[]).map((c) => {
        if (c.type === 'echeance') return { type: 'text', text: texteDe([c]), styles: {} };
        if (titre && c.type === 'text') {
          return { ...c, styles: { ...(c.styles as Record<string, unknown>), bold: true } };
        }
        return c;
      })
    : b.content;
  const connu = BLOCS_DU_COMMENTAIRE.has(String(b.type));
  return {
    ...b,
    type: connu ? b.type : 'paragraph',
    props: connu ? b.props : {},
    content: connu || Array.isArray(enLigne) ? enLigne : [],
    children: enfants,
  };
}

/**
 * Le contenu enregistré, rangé en trois parties. Une case, où qu'elle soit,
 * est un objectif ; une formation choisie, une formation à suivre ; tout le
 * reste, le commentaire.
 */
function partager(contenu: Bloc[]): {
  objectifs: Objectif[];
  formations: Bloc[];
  commentaires: Bloc[];
} {
  const objectifs: Objectif[] = [];
  const formations: Bloc[] = [];
  const trier = (blocs: unknown): Bloc[] => {
    if (!Array.isArray(blocs)) return [];
    const gardes: Bloc[] = [];
    for (const b of blocs as Bloc[]) {
      if (b.type === 'checkListItem') {
        const o = enObjectif(b);
        if (o.texte) objectifs.push(o);
        gardes.push(...trier(b.children));
        continue;
      }
      if (b.type === 'formation') {
        const p = (b.props ?? {}) as { courseId?: unknown; titre?: unknown };
        if (typeof p.courseId === 'string' && p.courseId) {
          formations.push({
            ...(b.id ? { id: b.id } : {}),
            type: 'formation',
            props: { courseId: p.courseId, titre: typeof p.titre === 'string' ? p.titre : '' },
            children: [],
          });
        }
        continue;
      }
      gardes.push(enCommentaire(b, trier(b.children)));
    }
    return gardes;
  };
  const commentaires = trier(contenu);
  return { objectifs, formations, commentaires };
}

/** Aucune invite dans le texte : une ligne vide reste vide. */
const dictionnaire = {
  ...fr,
  placeholders: {
    ...fr.placeholders,
    default: '',
    emptyDocument: '',
    heading: '',
    bulletListItem: '',
    numberedListItem: '',
    checkListItem: '',
    toggleListItem: '',
  },
};

/**
 * Le commentaire : un texte libre, sans case à cocher. Pas de titre (la
 * page titre), ni d'image, de vidéo, de son ou de fichier.
 */
const schemaCommentaires = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    quote: defaultBlockSpecs.quote,
    table: defaultBlockSpecs.table,
    divider: defaultBlockSpecs.divider,
  },
});

// La barre de mise en forme (commentaire)

const STYLES: { style: 'bold' | 'italic' | 'underline'; libelle: string; icone: IconName }[] = [
  { style: 'bold', libelle: 'Gras', icone: 'format_bold' },
  { style: 'italic', libelle: 'Italique', icone: 'format_italic' },
  { style: 'underline', libelle: 'Souligné', icone: 'format_underlined' },
];

/** Un bouton de style : ni infobulle ni raccourci — B, I, U se lisent seuls. */
function BoutonStyle({ style, libelle, icone }: (typeof STYLES)[number]) {
  const Composants = useComponentsContext()!;
  const editeur = useBlockNoteEditor(schemaCommentaires);
  const actif = useEditorState({
    editor: editeur,
    selector: ({ editor }) => style in editor.getActiveStyles(),
  });
  return (
    <Composants.FormattingToolbar.Button
      className="bn-button"
      label={libelle}
      isSelected={actif}
      onClick={() => {
        editeur.focus();
        editeur.toggleStyles({ [style]: true });
      }}
      icon={<Icon name={icone} size={18} />}
    />
  );
}

/**
 * La barre qui paraît sur une sélection du commentaire : trois boutons. Pas
 * de type de bloc, de couleur, d'alignement ni de lien.
 */
function BarreDeMiseEnForme() {
  const editeur = useBlockNoteEditor(schemaCommentaires);
  const texte = useEditorState({
    editor: editeur,
    selector: ({ editor }) =>
      editor.isEditable &&
      (editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]).some(
        (b) => b.content !== undefined,
      ),
  });
  if (!texte) return null;
  return (
    <FormattingToolbar>
      {STYLES.map((s) => (
        <BoutonStyle key={s.style} {...s} />
      ))}
    </FormattingToolbar>
  );
}

// La fiche

/** « Commentaires » entre deux filets : l'intitulé d'une partie. */
function Intertitre({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-5 pt-5 pb-1.5">
      <span aria-hidden className="h-px min-w-6 flex-1 bg-line" />
      <h4 className="shrink-0 text-[10px] font-extrabold tracking-[0.14em] text-ink-muted uppercase">
        {children}
      </h4>
      <span aria-hidden className="h-px min-w-6 flex-1 bg-line" />
    </div>
  );
}

export function EditeurFicheObjectifs({
  contenu,
  modifiable,
  formations,
  catalogue = [],
  onChange,
  focusSignal = 0,
  className,
  statuts,
  annee,
  jourEvaluation,
}: {
  contenu: Record<string, unknown>[];
  modifiable: boolean;
  formations: FormationDeLaFiche[];
  catalogue?: FormationProposable[];
  onChange?: (blocs: Record<string, unknown>[]) => void;
  /** Chaque changement ramène le curseur sur le dernier objectif (le crayon). */
  focusSignal?: number;
  /** La marge autour de la fiche. */
  className?: string;
  /**
   * Où l'agent dit en être de chaque objectif : c'est son auto-évaluation qui
   * colore les cases, bleu (atteint), jaune (partiellement), rouge (non
   * atteint). La fiche suit à mesure ; ses cases ne se cliquent pas.
   */
  statuts?: Record<string, StatutObjectif>;
  annee: number;
  /** Le jour de l'évaluation, « MM-JJ » : il borne les échéances de l'année. */
  jourEvaluation: string;
}) {
  // La fiche se range une fois, à l'ouverture ; chaque partie vit ensuite
  // de son côté, et l'enregistrement les remet bout à bout.
  const [depart] = useState(() => partager(contenu as Bloc[]));
  const parties = useRef(depart);
  const [choisies, setChoisies] = useState(depart.formations);

  const publier = useCallback(() => {
    const { objectifs, formations: aSuivre, commentaires } = parties.current;
    onChange?.([
      ...objectifs.filter((o) => o.texte.trim()).map(enCase),
      ...aSuivre,
      ...(aDuTexte(commentaires) ? commentaires : []),
    ]);
  }, [onChange]);

  const commentaireEcrit = aDuTexte(depart.commentaires);

  return (
    <div className={cn('fiche-objectifs', className)}>
      {modifiable ? (
        <EditeurObjectifs
          initial={depart.objectifs}
          annee={annee}
          jourEvaluation={jourEvaluation}
          statuts={statuts}
          focusSignal={focusSignal}
          onChange={(objectifs) => {
            parties.current = { ...parties.current, objectifs };
            publier();
          }}
        />
      ) : depart.objectifs.length ? (
        <ListeObjectifs objectifs={depart.objectifs} annee={annee} statuts={statuts} />
      ) : null}
      <FormationsASuivre
        choisies={choisies}
        catalogue={catalogue}
        suivis={formations}
        modifiable={modifiable}
        onChange={(blocs) => {
          setChoisies(blocs);
          parties.current = { ...parties.current, formations: blocs };
          publier();
        }}
      />
      {modifiable || commentaireEcrit ? (
        <>
          <Intertitre>Commentaires</Intertitre>
          <ZoneCommentaires
            initial={depart.commentaires}
            modifiable={modifiable}
            onChange={(blocs) => {
              parties.current = { ...parties.current, commentaires: blocs };
              publier();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

// Les objectifs

/**
 * Les objectifs, en lecture : la case à la couleur de l'auto-évaluation, le
 * texte, l'échéance. Un objectif atteint s'efface d'un ton, barré et gris :
 * ce qui reste à faire ressort seul.
 */
function ListeObjectifs({
  objectifs,
  annee,
  statuts,
}: {
  objectifs: Objectif[];
  annee: number;
  statuts?: Record<string, StatutObjectif>;
}) {
  return (
    <ul className="flex flex-col px-5">
      {objectifs.map((o) => {
        const statut = statuts?.[o.id];
        return (
          <li key={o.id} className="flex items-start gap-[11px] py-1">
            <Case statut={statut} />
            <p
              className={cn(
                'min-w-0 flex-1 text-[12.5px] leading-[1.5] break-words text-ink',
                statut === 'atteint' && 'text-ink-muted line-through decoration-ink-muted/55',
              )}
            >
              {o.texte}
            </p>
            {o.echeance ? <Echeance date={o.echeance} annee={annee} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Les objectifs, à rédiger : chacun son texte, et son échéance s'il en faut
 * une, choisie dans l'année, au plus tard le jour de l'évaluation. Les
 * objectifs se rangent par échéance quand on quitte la puce. Entrée ouvre un
 * nouvel objectif ; Retour arrière sur un objectif vide le retire ; les
 * flèches passent de l'un à l'autre. Une fiche dont l'évaluation est passée
 * garde ses échéances : le texte seul s'y corrige, et rien ne s'y ajoute.
 */
function EditeurObjectifs({
  initial,
  annee,
  jourEvaluation,
  statuts,
  focusSignal,
  onChange,
}: {
  initial: Objectif[];
  annee: number;
  jourEvaluation: string;
  statuts?: Record<string, StatutObjectif>;
  focusSignal: number;
  onChange: (objectifs: Objectif[]) => void;
}) {
  const [lignes, setLignes] = useState(initial);
  const uid = useId();
  const idDe = (id: string) => `${uid}-${id}`;
  const idEcheance = (id: string) => `${uid}-${id}-echeance`;
  const jour = aujourdhui();
  const { du, au } = echeancesDeLAnnee(annee, jourEvaluation);
  const figee = au < jour;
  // Une échéance se choisit dans l'année, à partir d'aujourd'hui.
  const debut = du > jour ? du : jour;

  // Où va le curseur : un objectif (au début ou à la fin de son texte), ou
  // une échéance. Il s'y pose une fois la liste affichée : une ligne qu'on
  // vient d'ajouter n'existe qu'après le rendu.
  const aViser = useRef<{ id: string; ou: 'debut' | 'fin' | 'echeance' } | null>(null);

  const poserLeCurseur = () => {
    const cible = aViser.current;
    if (!cible) return;
    const champ = document.getElementById(
      cible.ou === 'echeance' ? idEcheance(cible.id) : idDe(cible.id),
    );
    if (!(champ instanceof HTMLTextAreaElement || champ instanceof HTMLInputElement)) return;
    aViser.current = null;
    champ.focus();
    if (champ instanceof HTMLTextAreaElement) {
      const position = cible.ou === 'fin' ? champ.value.length : 0;
      champ.setSelectionRange(position, position);
    }
  };

  useEffect(poserLeCurseur);

  /** Le curseur dans un objectif, au début ou à la fin de son texte. */
  const viser = (id: string, ou: 'debut' | 'fin' = 'fin') => {
    aViser.current = { id, ou };
    poserLeCurseur();
  };

  const publier = (suivantes: Objectif[]) => {
    setLignes(suivantes);
    onChange(suivantes);
  };

  const changer = (id: string, quoi: Partial<Objectif>) =>
    publier(lignes.map((l) => (l.id === id ? { ...l, ...quoi } : l)));

  /**
   * Les objectifs par échéance, quand on quitte une puce : rien ne bouge
   * pendant qu'on choisit. Le curseur reste sur la puce qui l'avait.
   */
  const ranger = () => {
    const rangees = parEcheance(lignes);
    if (rangees.every((l, i) => l === lignes[i])) return;
    const ici = lignes.find((l) => document.activeElement?.id === idEcheance(l.id));
    if (ici) aViser.current = { id: ici.id, ou: 'echeance' };
    publier(rangees);
  };

  /** Un objectif de plus, en bas de la liste, sans échéance. */
  const ajouter = () => {
    const neuf: Objectif = { id: crypto.randomUUID(), texte: '', echeance: null };
    publier([...lignes, neuf]);
    viser(neuf.id);
  };

  const retirer = (l: Objectif) => {
    const i = lignes.findIndex((x) => x.id === l.id);
    const voisine = lignes[i - 1] ?? lignes[i + 1];
    publier(lignes.filter((x) => x.id !== l.id));
    if (voisine) viser(voisine.id);
  };

  // Le crayon : le curseur au bout du dernier objectif, ou sur un premier.
  useEffect(() => {
    if (focusSignal === 0) return;
    const dernier = lignes.at(-1);
    if (dernier) viser(dernier.id);
    else if (!figee) ajouter();
    // Seul le signal compte : la liste qu'on rédige ne relance rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSignal]);

  const auClavier = (e: KeyboardEvent<HTMLTextAreaElement>, l: Objectif) => {
    const champ = e.currentTarget;
    const i = lignes.findIndex((x) => x.id === l.id);
    if (e.key === 'Enter') {
      // Un objectif tient sur une ligne : Entrée en ouvre un autre.
      e.preventDefault();
      if (!e.shiftKey && !figee && l.texte.trim()) ajouter();
      return;
    }
    if (e.key === 'Backspace' && !l.texte) {
      e.preventDefault();
      retirer(l);
      return;
    }
    const auDebut = champ.selectionStart === 0 && champ.selectionEnd === 0;
    const aLaFin = champ.selectionStart === champ.value.length;
    if (e.key === 'ArrowUp' && auDebut && lignes[i - 1]) {
      e.preventDefault();
      viser(lignes[i - 1]!.id);
    } else if (e.key === 'ArrowDown' && aLaFin && lignes[i + 1]) {
      e.preventDefault();
      viser(lignes[i + 1]!.id, 'debut');
    }
  };

  return (
    <div className="flex flex-col px-5">
      <ul className="flex flex-col">
        {lignes.map((l, i) => (
          <li key={l.id} className="flex items-start gap-[11px] py-1">
            <span className="pt-[2px]">
              <Case statut={statuts?.[l.id]} />
            </span>
            <TexteModifiable
              id={idDe(l.id)}
              valeur={l.texte}
              label={`Objectif ${i + 1}`}
              onChange={(texte) => changer(l.id, { texte })}
              onKeyDown={(e) => auClavier(e, l)}
            />
            {figee ? (
              l.echeance ? (
                <Echeance date={l.echeance} annee={annee} className="pt-[3px]" />
              ) : null
            ) : (
              <ChoixEcheance
                id={idEcheance(l.id)}
                date={l.echeance}
                annee={annee}
                min={debut}
                max={au}
                label={`Échéance de l’objectif ${i + 1}`}
                onChoix={(echeance) => changer(l.id, { echeance })}
                onQuitter={ranger}
              />
            )}
            <button
              type="button"
              aria-label={`Retirer l’objectif ${i + 1}`}
              title="Retirer"
              onClick={() => retirer(l)}
              className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted/70 transition-colors duration-150 outline-none hover:bg-hover hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/35"
            >
              <Icon name="close" size={16} />
            </button>
          </li>
        ))}
      </ul>
      {figee ? null : (
        <Button variant="ghost" size="sm" className="mt-1 -ml-2 self-start" onClick={ajouter}>
          <Icon name="add" size={16} />
          Ajouter un objectif
        </Button>
      )}
    </div>
  );
}

/** Le texte d'un objectif, à réécrire : une ligne, qui s'allonge avec ce qu'on y écrit. */
function TexteModifiable({
  id,
  valeur,
  label,
  onChange,
  onKeyDown,
}: {
  id: string;
  valeur: string;
  label: string;
  onChange: (texte: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const champ = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = champ.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [valeur]);
  // La ligne rétrécit (la puce voisine prend sa date, l'écran tourne) : le
  // texte passe à la ligne, la hauteur suit. Elle change à l'image suivante,
  // hors de l'observation.
  useEffect(() => {
    const el = champ.current;
    if (!el) return;
    let largeur = el.clientWidth;
    let image = 0;
    const observation = new ResizeObserver(() => {
      if (el.clientWidth === largeur) return;
      largeur = el.clientWidth;
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      });
    });
    observation.observe(el);
    return () => {
      observation.disconnect();
      cancelAnimationFrame(image);
    };
  }, []);
  return (
    <textarea
      ref={champ}
      id={id}
      rows={1}
      aria-label={label}
      value={valeur}
      maxLength={OBJECTIF_TEXTE_MAX}
      // Un texte collé sur plusieurs lignes se met sur une seule.
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
      onKeyDown={onKeyDown}
      className="-mx-1.5 min-w-0 flex-1 resize-none overflow-hidden rounded-[8px] bg-transparent px-1.5 py-[3px] text-[12.5px] leading-[1.5] text-ink transition-colors duration-150 outline-none hover:bg-hover/70 focus:bg-hover"
    />
  );
}

// Les formations à suivre

/**
 * Certifiée, ou terminée quand elle n'a pas d'évaluation : l'agent l'a
 * obtenue, elle ne se demande plus.
 */
const faite = (suivi?: FormationDeLaFiche) =>
  suivi?.statut === 'terminee' || suivi?.statut === 'certifiee';

/**
 * Une formation en badge, sur une ligne avec les autres. Le rayon vaut la
 * moitié d'une ligne : un titre trop long pour l'écran passe à la ligne au
 * lieu d'être coupé.
 */
const BADGE =
  'inline-flex max-w-full items-center gap-1.5 rounded-[15px] border px-3 py-[5px] text-left text-[12px] font-semibold transition-colors duration-150';

/**
 * Les formations à suivre, en badges, sans échéance : elles s'évaluent avec
 * les objectifs de l'année. Le n+1 voit celles que l'agent n'a pas encore
 * obtenues, commencées ou non, et choisit d'un clic ; l'agent lit celles qui
 * sont demandées, chacune mène à sa page.
 */
function FormationsASuivre({
  choisies,
  catalogue,
  suivis,
  modifiable,
  onChange,
}: {
  /** Les blocs « formation » de la fiche : ce que le n+1 a demandé. */
  choisies: Bloc[];
  catalogue: FormationProposable[];
  /** Où en est l'agent de chaque formation. */
  suivis: FormationDeLaFiche[];
  modifiable: boolean;
  onChange: (blocs: Bloc[]) => void;
}) {
  const idDe = (b: Bloc) => String((b.props as { courseId: string }).courseId);
  const titreDe = (b: Bloc) => String((b.props as { titre?: string }).titre ?? '');
  const obtenue = (courseId: string) => faite(suivis.find((f) => f.courseId === courseId));

  if (!modifiable) {
    if (!choisies.length) return null;
    return (
      <>
        <Intertitre>Formations à suivre</Intertitre>
        <div className="flex flex-wrap gap-2 px-5 pt-1.5 pb-2">
          {choisies.map((b) => (
            <Link
              key={idDe(b)}
              href={`/academy/${idDe(b)}`}
              className={cn(
                BADGE,
                'border-primary/20 bg-primary-soft text-primary hover:border-primary/45',
              )}
            >
              <span className="min-w-0">{titreDe(b) || 'Formation APIX Academy'}</span>
            </Link>
          ))}
        </div>
      </>
    );
  }

  // Le catalogue (la page en ôte ce que l'agent encadre), et ce qui en est
  // sorti depuis qu'on l'a demandé, pour pouvoir le retirer ; sans ce que
  // l'agent a déjà obtenu.
  const lignes = [
    ...catalogue.map((c) => ({ courseId: c.id, titre: c.title })),
    ...choisies
      .filter((b) => !catalogue.some((c) => c.id === idDe(b)))
      .map((b) => ({ courseId: idDe(b), titre: titreDe(b) || 'Formation retirée' })),
  ].filter((l) => !obtenue(l.courseId));
  if (!lignes.length) return null;

  const basculer = (courseId: string, titre: string) => {
    const deja = choisies.some((b) => idDe(b) === courseId);
    onChange(
      deja
        ? choisies.filter((b) => idDe(b) !== courseId)
        : [
            ...choisies,
            {
              id: crypto.randomUUID(),
              type: 'formation',
              props: { courseId, titre },
              children: [],
            },
          ],
    );
  };

  return (
    <>
      <Intertitre>Formations à suivre</Intertitre>
      <div className="flex flex-wrap gap-2 px-5 pt-1.5 pb-2">
        {lignes.map(({ courseId, titre }) => {
          const choisie = choisies.some((b) => idDe(b) === courseId);
          return (
            <button
              key={courseId}
              type="button"
              aria-pressed={choisie}
              onClick={() => basculer(courseId, titre)}
              className={cn(
                BADGE,
                'outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
                choisie
                  ? 'border-primary bg-primary pl-2 text-primary-ink'
                  : 'border-line bg-surface text-ink hover:border-primary/40 hover:text-primary',
              )}
            >
              {choisie ? <Icon name="check" size={15} className="shrink-0" /> : null}
              <span className="min-w-0">{titre}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// Les commentaires

function ZoneCommentaires({
  initial,
  modifiable,
  onChange,
}: {
  initial: Bloc[];
  modifiable: boolean;
  onChange: (blocs: Record<string, unknown>[]) => void;
}) {
  const { theme } = usePreferences();
  const editeur = useCreateBlockNote({
    schema: schemaCommentaires,
    dictionary: dictionnaire,
    initialContent: (initial.length ? initial : undefined) as unknown as NonNullable<
      Parameters<typeof useCreateBlockNote>[0]
    >['initialContent'],
  });

  return (
    <div
      className={cn('pb-1', modifiable && 'min-h-12 cursor-text')}
      // Cliquer dans la zone, sous le texte, place le curseur à la fin.
      onMouseDown={(e) => {
        if (!modifiable || e.target !== e.currentTarget) return;
        e.preventDefault();
        const dernier = editeur.document.at(-1);
        if (dernier) editeur.setTextCursorPosition(dernier, 'end');
        editeur.focus();
      }}
    >
      <BlockNoteView
        editor={editeur}
        editable={modifiable}
        theme={theme === 'sombre' ? 'dark' : 'light'}
        sideMenu={false}
        slashMenu={false}
        formattingToolbar={false}
        emojiPicker={false}
        onChange={() => onChange(editeur.document as unknown as Record<string, unknown>[])}
      >
        <FormattingToolbarController formattingToolbar={BarreDeMiseEnForme} />
      </BlockNoteView>
    </div>
  );
}
