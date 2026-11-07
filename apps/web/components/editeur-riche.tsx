'use client';

// Sa feuille de style (@blocknote/mantine/style.css) est importée par la
// page qui l'affiche : chargé à la demande, l'éditeur ne la porte pas.
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core';
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
import { memo, useCallback, useEffect, useMemo, type KeyboardEvent, type MouseEvent } from 'react';
import {
  NIVEAU_MAX,
  normaliserTexteRiche,
  texteBrut,
  type BlocDeTexte,
  type FormeDuChamp,
  type TexteRiche,
  type TypeDeBloc,
} from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { Icon, type IconName } from './icons';
import { usePreferences } from './preferences';

/*
   Un champ de texte mis en forme, sur BlockNote : du gras, de l'italique,
   et, quand le champ les admet, des puces et des numéros (« - » ou « 1. »
   en tête de ligne, ou la barre qui paraît sur une sélection). Rien d'autre :
   ni titre, ni lien, ni couleur, ni souligné. Un champ en puces n'a que des
   puces : vide, il en montre une, grisée, qui ne s'enlève pas (ADR-0153).

   Ce qui s'enregistre n'est pas le document de BlockNote mais le texte riche
   des contrats (ADR-0150), que le PDF imprime : l'éditeur le lit à
   l'ouverture et l'écrit à chaque frappe.
*/

type Schema = typeof schemaListes;

/**
 * Les styles admis : gras et italique. Le schéma garde les liens, que
 * BlockNote exige, mais leur extension est coupée : aucun lien ne se pose
 * ni ne se colle.
 */
const styleSpecs = { bold: defaultStyleSpecs.bold, italic: defaultStyleSpecs.italic };
const inlineContentSpecs = defaultInlineContentSpecs;
const SANS_LIENS = ['link', 'linkToolbar'];

/** Du texte seul, en paragraphes. */
const schemaTexte = BlockNoteSchema.create({
  blockSpecs: { paragraph: defaultBlockSpecs.paragraph },
  inlineContentSpecs,
  styleSpecs,
});

/**
 * Des puces seulement. Le paragraphe reste au schéma, que BlockNote exige :
 * une ligne qui y passe redevient aussitôt une puce.
 */
const schemaPuces = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    bulletListItem: defaultBlockSpecs.bulletListItem,
  },
  inlineContentSpecs,
  styleSpecs,
});

/** Des paragraphes, des puces et des numéros. */
const schemaListes = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
  },
  inlineContentSpecs,
  styleSpecs,
});

/** Le schéma de chaque forme de champ. */
const SCHEMAS = { texte: schemaTexte, listes: schemaListes, puces: schemaPuces } as const;

/** Aucune invite dans le texte : une ligne vide reste vide. */
const dictionnaire = {
  ...fr,
  placeholders: {
    ...fr.placeholders,
    default: '',
    emptyDocument: '',
    bulletListItem: '',
    numberedListItem: '',
  },
};

// ──────────────────────────────────────────────── du texte riche à BlockNote, et retour

type BlocBN = {
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: BlocBN[];
};

const VERS_BLOCKNOTE: Record<TypeDeBloc, string> = {
  paragraphe: 'paragraph',
  puce: 'bulletListItem',
  numero: 'numberedListItem',
};

/**
 * Les blocs de BlockNote d'un texte riche : un bloc de niveau n se range
 * sous le dernier bloc de niveau n - 1, comme l'éditeur imbrique ses listes.
 * Dans un champ en puces, chaque bloc en est une.
 */
function versBlockNote(t: TexteRiche, forme: FormeDuChamp): BlocBN[] {
  const racine: BlocBN[] = [];
  const derniers: BlocBN[] = [];
  for (const b of t) {
    const bloc: BlocBN = {
      type: forme === 'puces' ? 'bulletListItem' : VERS_BLOCKNOTE[b.type],
      props: b.debut ? { start: b.debut } : {},
      content: b.segments.map((s) => ({
        type: 'text',
        text: s.texte,
        styles: { ...(s.gras ? { bold: true } : {}), ...(s.italique ? { italic: true } : {}) },
      })),
      children: [],
    };
    const niveau = Math.min(b.niveau, derniers.length);
    if (niveau === 0) racine.push(bloc);
    else derniers[niveau - 1]!.children!.push(bloc);
    derniers.length = niveau;
    derniers[niveau] = bloc;
  }
  return racine;
}

/** Le texte riche d'un document de BlockNote : ses blocs à plat, chacun à son niveau. */
function depuisBlockNote(document: readonly BlocBN[]): TexteRiche {
  const blocs: BlocDeTexte[] = [];
  const parcourir = (liste: readonly BlocBN[], niveau: number) => {
    for (const b of liste) {
      const type: TypeDeBloc =
        b.type === 'bulletListItem'
          ? 'puce'
          : b.type === 'numberedListItem'
            ? 'numero'
            : 'paragraphe';
      const debut = Number(b.props?.start);
      blocs.push({
        type,
        niveau: Math.min(niveau, NIVEAU_MAX),
        ...(type === 'numero' && debut > 1 ? { debut } : {}),
        segments: segmentsDe(b.content),
      });
      parcourir(b.children ?? [], niveau + 1);
    }
  };
  parcourir(document, 0);
  return normaliserTexteRiche(blocs);
}

function segmentsDe(contenu: unknown): BlocDeTexte['segments'] {
  if (!Array.isArray(contenu)) return [];
  return contenu.flatMap(
    (c: { type?: string; text?: string; styles?: Record<string, unknown>; content?: unknown }) => {
      if (c.type === 'text') {
        return [
          {
            texte: String(c.text ?? ''),
            gras: Boolean(c.styles?.bold),
            italique: Boolean(c.styles?.italic),
          },
        ];
      }
      // Un lien, s'il en venait un : son texte.
      return Array.isArray(c.content) ? segmentsDe(c.content) : [];
    },
  );
}

// ──────────────────────────────────────────────── la barre de mise en forme

/** Un style : gras ou italique. Ni infobulle ni raccourci : B et I se lisent seuls. */
function BoutonStyle({
  style,
  libelle,
  icone,
}: {
  style: 'bold' | 'italic';
  libelle: string;
  icone: IconName;
}) {
  const Composants = useComponentsContext()!;
  const editeur = useBlockNoteEditor<
    Schema['blockSchema'],
    Schema['inlineContentSchema'],
    Schema['styleSchema']
  >();
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

/** Une liste : les blocs choisis y passent, ou en sortent s'ils y sont tous déjà. */
function BoutonListe({
  type,
  libelle,
  icone,
}: {
  type: 'bulletListItem' | 'numberedListItem';
  libelle: string;
  icone: IconName;
}) {
  const Composants = useComponentsContext()!;
  const editeur = useBlockNoteEditor<
    Schema['blockSchema'],
    Schema['inlineContentSchema'],
    Schema['styleSchema']
  >();
  const blocs = () => editeur.getSelection()?.blocks ?? [editeur.getTextCursorPosition().block];
  const actif = useEditorState({
    editor: editeur,
    selector: ({ editor }) =>
      (editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]).every(
        (b) => b.type === type,
      ),
  });
  return (
    <Composants.FormattingToolbar.Button
      className="bn-button"
      label={libelle}
      isSelected={actif}
      onClick={() => {
        editeur.focus();
        const tous = blocs().every((b) => b.type === type);
        for (const b of blocs())
          editeur.updateBlock(b, { type: tous ? 'paragraph' : type, props: {} });
      }}
      icon={<Icon name={icone} size={18} />}
    />
  );
}

/**
 * La barre qui paraît sur une sélection : gras, italique, et les listes si
 * le champ les admet au choix (un champ en puces n'en a pas d'autre).
 */
function barreDeMiseEnForme(listes: boolean) {
  return function Barre() {
    return (
      <FormattingToolbar>
        <BoutonStyle style="bold" libelle="Gras" icone="format_bold" />
        <BoutonStyle style="italic" libelle="Italique" icone="format_italic" />
        {listes ? (
          <>
            <BoutonListe
              type="bulletListItem"
              libelle="Liste à puces"
              icone="format_list_bulleted"
            />
            <BoutonListe
              type="numberedListItem"
              libelle="Liste numérotée"
              icone="format_list_numbered"
            />
          </>
        ) : null}
      </FormattingToolbar>
    );
  };
}
const BarreTexte = barreDeMiseEnForme(false);
const BarreListes = barreDeMiseEnForme(true);

// ──────────────────────────────────────────────── l'éditeur

/**
 * Le champ. Près de sa limite, celle de la place du texte sur le PDF, il
 * compte ses caractères ; au-delà, il passe au rouge et la grille ne
 * s'enregistre plus.
 */
function EditeurRiche({
  valeur,
  onChange,
  forme,
  max,
  label,
  compact = false,
  autoFocus = false,
}: {
  valeur: TexteRiche;
  onChange: (t: TexteRiche) => void;
  /** Du texte seul ; des paragraphes, des puces et des numéros ; ou des puces seulement. */
  forme: FormeDuChamp;
  max: number;
  /** Le nom du champ, pour les lecteurs d'écran. */
  label: string;
  /** Une ligne à l'ouverture, comme le texte d'un objectif. */
  compact?: boolean;
  /** Le curseur s'y pose à l'ouverture : le champ qu'on vient d'ajouter. */
  autoFocus?: boolean;
}) {
  const { theme } = usePreferences();
  const puces = forme === 'puces';
  const editeur = useCreateBlockNote({
    schema: SCHEMAS[forme] as Schema,
    dictionary: dictionnaire,
    trailingBlock: false,
    disableExtensions: SANS_LIENS,
    domAttributes: {
      editor: { 'aria-label': label, 'aria-multiline': 'true', role: 'textbox' },
    },
    initialContent: (valeur.length
      ? versBlockNote(valeur, forme)
      : puces
        ? [{ type: 'bulletListItem' }]
        : undefined) as never,
  });
  // Le nom suit le champ : l'objectif 3 devient l'objectif 2 quand le 2 se retire.
  useEffect(() => {
    editeur.domElement?.setAttribute('aria-label', label);
  }, [editeur, label]);
  useEffect(() => {
    if (!autoFocus) return;
    const image = requestAnimationFrame(() => editeur.focus());
    return () => cancelAnimationFrame(image);
    // À l'ouverture seulement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editeur]);
  const longueur = texteBrut(valeur).length;
  const trop = longueur > max;
  const changement = useCallback(() => {
    if (puces) {
      // Une ligne qui a perdu sa puce (un collage, tout effacé, une ligne
      // remontée d'un cran) la retrouve aussitôt ; le texte se publie ensuite.
      const sansPuce: BlocBN[] = [];
      const parcourir = (blocs: readonly BlocBN[]) => {
        for (const b of blocs) {
          if (b.type !== 'bulletListItem') sansPuce.push(b);
          parcourir(b.children ?? []);
        }
      };
      parcourir(editeur.document as unknown as BlocBN[]);
      if (sansPuce.length > 0) {
        queueMicrotask(() =>
          editeur.transact(() => {
            for (const b of sansPuce) {
              editeur.updateBlock(b as never, { type: 'bulletListItem', props: {} } as never);
            }
          }),
        );
        return;
      }
    }
    onChange(depuisBlockNote(editeur.document as unknown as BlocBN[]));
  }, [editeur, onChange, puces]);
  // L'éditeur ne se redessine pas à chaque frappe : il tient son texte, seul
  // le compteur suit.
  const vue = useMemo(
    () => (
      <BlockNoteView
        editor={editeur}
        theme={theme === 'sombre' ? 'dark' : 'light'}
        sideMenu={false}
        slashMenu={false}
        formattingToolbar={false}
        emojiPicker={false}
        filePanel={false}
        tableHandles={false}
        linkToolbar={false}
        onChange={changement}
      >
        <FormattingToolbarController
          formattingToolbar={forme === 'listes' ? BarreListes : BarreTexte}
        />
      </BlockNoteView>
    ),
    [editeur, theme, forme, changement],
  );

  /**
   * Le clavier d'un formulaire : Tab passe au champ suivant, sauf dans une
   * liste, où il range la ligne sous la précédente (deux crans au plus).
   * Maj+Entrée ne coupe pas la ligne : Entrée ouvre un nouveau bloc. Dans
   * un champ en puces, la première puce ne s'enlève pas, et Entrée sur une
   * puce vide ne sort pas de la liste.
   */
  const auClavier = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (puces && (e.key === 'Backspace' || e.key === 'Enter') && !e.altKey && !e.metaKey) {
      const { selection } = editeur.prosemirrorState;
      if (!selection.empty || selection.$from.parentOffset !== 0) return;
      const bloc = editeur.getTextCursorPosition().block;
      const imbrique = Boolean(editeur.getParentBlock(bloc));
      if (e.key === 'Enter') {
        // Une puce vide au premier niveau reste où elle est.
        const vide = Array.isArray(bloc.content) && bloc.content.length === 0;
        if (vide && !imbrique) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (!imbrique && editeur.document[0]?.id === bloc.id) {
        // La première puce reste, même vide.
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Au début d'une autre ligne, Retour arrière la remonte d'un cran ou la
      // joint à la ligne d'avant. BlockNote ôterait d'abord sa puce : il la
      // trouve déjà en paragraphe, et la ligne qui reste la retrouve.
      editeur.updateBlock(bloc, { type: 'paragraph', props: {} });
      return;
    }
    if (e.key !== 'Tab') return;
    const bloc = editeur.getTextCursorPosition().block;
    let profondeur = 0;
    for (let p = editeur.getParentBlock(bloc); p; p = editeur.getParentBlock(p)) profondeur += 1;
    const dansUneListe = bloc.type === 'bulletListItem' || bloc.type === 'numberedListItem';
    const aRanger = e.shiftKey ? profondeur > 0 : dansUneListe && profondeur < NIVEAU_MAX;
    // Laissé à l'éditeur, Tab range la ligne ; arrêté ici, le navigateur passe au champ voisin.
    if (forme === 'texte' || !aRanger) e.stopPropagation();
  };

  /** Un clic sous le texte place le curseur à la fin. */
  const auClic = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const dernier = editeur.document.at(-1);
    if (dernier) editeur.setTextCursorPosition(dernier, 'end');
    editeur.focus();
  };

  return (
    <div>
      <div
        onKeyDownCapture={auClavier}
        onMouseDown={auClic}
        className={cn(
          'editeur-riche cursor-text rounded-controle border bg-surface py-[7px] transition-colors duration-150',
          'focus-within:outline-2 focus-within:outline-offset-1',
          // Trop long, le cadre reste rouge, même pendant qu'on écrit.
          trop
            ? 'border-danger focus-within:border-danger focus-within:outline-danger/40'
            : 'border-line focus-within:border-primary focus-within:outline-primary/40',
          compact ? 'min-h-[38px]' : 'min-h-[58px]',
        )}
      >
        {vue}
      </div>
      {longueur >= max * 0.8 ? (
        <p
          className={cn(
            'mt-1 text-right text-[11px] tabular-nums',
            trop ? 'font-semibold text-danger' : 'text-ink-muted',
          )}
        >
          {longueur} / {max}
        </p>
      ) : null}
    </div>
  );
}

export default memo(EditeurRiche);
