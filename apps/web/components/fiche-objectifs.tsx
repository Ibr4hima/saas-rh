'use client';

// Sa feuille de style (@blocknote/mantine/style.css) est importée par les
// pages qui l'affichent : chargé à la demande, l'éditeur ne la porte pas.
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs } from '@blocknote/core';
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
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { FormationDeLaFiche, FormationProposable, StatutObjectif } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { Icon, type IconName } from './icons';
import { usePreferences } from './preferences';

/* ————————————————————————————————————————————————————————————————
   La fiche d'objectifs d'un semestre, en trois parties. Le titre n'est pas
   à écrire : la page le pose (« Objectifs du 1er semestre de 2026 »).

   1. Les OBJECTIFS : des cases à cocher, et rien d'autre. Du texte simple,
      sans gras, ni italique, ni puce, ni lien. Il reste toujours une case :
      la première ne s'efface pas.
   2. Les FORMATIONS À SUIVRE : le catalogue de l'APIX Academy. Celles que
      l'agent a terminées ne se cochent pas ; cocher une autre la lui
      demande, et elle s'évalue comme un objectif.
   3. Les COMMENTAIRES : un texte libre sur les objectifs fixés (gras,
      italique, souligné, listes, citations), sans case à cocher.

   Les trois parties tiennent dans un seul contenu, dans cet ordre : les
   cases, puis les blocs « formation », puis les blocs du commentaire. Le
   type d'un bloc dit sa partie ; une fiche rédigée avant ce partage s'y
   range à l'ouverture (ses paragraphes et ses puces deviennent le
   commentaire, ses échéances du texte).

   Le n+1 rédige ; l'agent lit la même fiche, sans rien pouvoir y changer.
   ———————————————————————————————————————————————————————————————— */

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

/** Un objectif : une case, son texte seul, sans rien dessous. */
function enCase(b: Bloc): Bloc {
  const texte = texteDe(b.content);
  return {
    ...(b.id ? { id: b.id } : {}),
    type: 'checkListItem',
    props: { checked: Boolean((b.props as { checked?: unknown } | undefined)?.checked) },
    content: texte ? [{ type: 'text', text: texte, styles: {} }] : [],
    children: [],
  };
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
  objectifs: Bloc[];
  formations: Bloc[];
  commentaires: Bloc[];
} {
  const objectifs: Bloc[] = [];
  const formations: Bloc[] = [];
  const trier = (blocs: unknown): Bloc[] => {
    if (!Array.isArray(blocs)) return [];
    const gardes: Bloc[] = [];
    for (const b of blocs as Bloc[]) {
      if (b.type === 'checkListItem') {
        objectifs.push(enCase(b));
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

/** Une fiche neuve s'ouvre sur un objectif à cocher. */
const FICHE_NEUVE: Bloc[] = [{ type: 'checkListItem' }];

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
 * Les objectifs : la case, et le texte nu. Le paragraphe et le lien restent
 * au schéma, l'éditeur ne s'en passe pas ; la fiche rechange aussitôt l'un en
 * case, l'autre en texte.
 */
const schemaObjectifs = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    checkListItem: defaultBlockSpecs.checkListItem,
  },
  inlineContentSpecs: defaultInlineContentSpecs,
  styleSpecs: {},
});

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

/** Les couleurs d'une case que l'agent ne dit pas atteinte (globals.css, `.fiche-statuts`). */
const DESSIN_DU_STATUT: Record<StatutObjectif, string> = {
  atteint: '',
  partiel:
    '--statut-fond: var(--tg-partiel); --statut-filet: var(--tg-partiel-line); --statut-signe: var(--tiret);',
  non_atteint:
    '--statut-fond: var(--tg-danger); --statut-filet: var(--tg-danger); --statut-signe: var(--croix);',
};

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
}: {
  contenu: Record<string, unknown>[];
  modifiable: boolean;
  formations: FormationDeLaFiche[];
  catalogue?: FormationProposable[];
  onChange?: (blocs: Record<string, unknown>[]) => void;
  /** Chaque changement ramène le curseur en fin d'objectifs (« Fixer des objectifs »). */
  focusSignal?: number;
  /** La marge autour de la fiche. */
  className?: string;
  /**
   * Où l'agent dit en être de chaque objectif — c'est son auto-évaluation qui
   * colore les cases : bleu (atteint, cochée), jaune (partiellement), rouge
   * (non atteint). La fiche suit à mesure ; ses cases ne se cliquent pas.
   */
  statuts?: Record<string, StatutObjectif>;
}) {
  // La fiche se range une fois, à l'ouverture ; chaque partie vit ensuite
  // de son côté, et l'enregistrement les remet bout à bout.
  const [depart] = useState(() => partager(contenu as Bloc[]));
  const parties = useRef(depart);
  const [choisies, setChoisies] = useState(depart.formations);

  const publier = useCallback(() => {
    const { objectifs, formations: aSuivre, commentaires } = parties.current;
    onChange?.([...objectifs, ...aSuivre, ...(aDuTexte(commentaires) ? commentaires : [])]);
  }, [onChange]);

  const objectifsEcrits = aDuTexte(depart.objectifs);
  const commentaireEcrit = aDuTexte(depart.commentaires);

  return (
    <div className={cn('fiche-objectifs', className)}>
      {modifiable || objectifsEcrits ? (
        <ZoneObjectifs
          initial={depart.objectifs}
          modifiable={modifiable}
          statuts={statuts}
          focusSignal={focusSignal}
          onChange={(blocs) => {
            parties.current = { ...parties.current, objectifs: blocs };
            publier();
          }}
        />
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

/** Le texte nu de chaque case, à plat : les cases imbriquées remontent à la suite. */
function aplatir(blocs: { props: unknown; content?: unknown; children: unknown[] }[]): Bloc[] {
  return blocs.flatMap((b) => [
    {
      type: 'checkListItem',
      props: { checked: Boolean((b.props as { checked?: unknown }).checked) },
      content: texteDe(b.content),
      children: [],
    },
    ...aplatir(b.children as typeof blocs),
  ]);
}

function ZoneObjectifs({
  initial,
  modifiable,
  statuts,
  focusSignal,
  onChange,
}: {
  initial: Bloc[];
  modifiable: boolean;
  statuts?: Record<string, StatutObjectif>;
  focusSignal: number;
  onChange: (blocs: Record<string, unknown>[]) => void;
}) {
  const { theme } = usePreferences();
  const editeur = useCreateBlockNote({
    schema: schemaObjectifs,
    dictionary: dictionnaire,
    // Pas de ligne fantôme sous la dernière case : cliquer sous les objectifs
    // reprend la dernière, plutôt que d'en ouvrir une vide.
    trailingBlock: false,
    initialContent: (initial.length ? initial : FICHE_NEUVE) as unknown as NonNullable<
      Parameters<typeof useCreateBlockNote>[0]
    >['initialContent'],
  });

  /** Le curseur au bout de la dernière case : c'est là qu'on ajoute. */
  const ecrireALaFin = useCallback(() => {
    const dernier = editeur.document.at(-1);
    if (!dernier) return;
    editeur.setTextCursorPosition(dernier, 'end');
    editeur.focus();
  }, [editeur]);

  useEffect(() => {
    if (focusSignal > 0 && modifiable) ecrireALaFin();
  }, [focusSignal, modifiable, ecrireALaFin]);

  // Les cases suivent l'auto-évaluation de l'agent : cochée, l'objectif est
  // atteint. Les poser n'est pas une rédaction : rien ne s'enregistre.
  const enPose = useRef(false);
  const statutsCle = statuts ? JSON.stringify(statuts) : undefined;
  useEffect(() => {
    if (!statuts) return;
    const ecarts = editeur.document.filter(
      (b) =>
        b.type === 'checkListItem' && Boolean(b.props.checked) !== (statuts[b.id] === 'atteint'),
    );
    if (!ecarts.length) return;
    enPose.current = true;
    try {
      for (const b of ecarts) {
        editeur.updateBlock(b.id, {
          type: 'checkListItem',
          props: { checked: statuts[b.id] === 'atteint' },
        });
      }
    } finally {
      enPose.current = false;
    }
    // `statutsCle` résume `statuts` : un nouvel objet de mêmes valeurs ne repose rien.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutsCle, editeur]);

  // Partiellement, non atteint : la case, restée décochée, prend la couleur
  // du choix — une règle par objectif, que BlockNote ne peut pas effacer en
  // redessinant ses blocs.
  const portee = useId();
  const couleurs = useMemo(() => {
    if (!statuts) return '';
    return Object.entries(statuts)
      .filter(([, s]) => s !== 'atteint')
      .map(
        ([id, s]) =>
          `[data-statuts="${portee}"] [data-id="${CSS.escape(id)}"] > .bn-block-content[data-content-type='checkListItem'] > div > input { ${DESSIN_DU_STATUT[s]} }`,
      )
      .join('\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutsCle, portee]);

  /**
   * Tout ce qui n'est pas une case le redevient : la ligne que l'éditeur
   * vient de sortir de la liste, un paragraphe collé, une case glissée sous
   * une autre ; un lien redevient son texte. Vrai si la fiche a changé
   * (l'enregistrement suivra).
   */
  const normaliser = (): boolean => {
    const doc = editeur.document;
    const textuel = (b: (typeof doc)[number]) =>
      (Array.isArray(b.content) ? b.content : []).every((c) => c.type === 'text');
    const enOrdre = (b: (typeof doc)[number]) =>
      b.type === 'checkListItem' && b.children.length === 0 && textuel(b);
    if (doc.every(enOrdre)) return false;
    editeur.transact(() => {
      if (doc.some((b) => b.children.length > 0)) {
        editeur.replaceBlocks(doc, aplatir(doc) as Parameters<typeof editeur.insertBlocks>[0]);
        return;
      }
      for (const b of doc) {
        if (enOrdre(b)) continue;
        editeur.updateBlock(b, {
          type: 'checkListItem',
          props: { checked: b.type === 'checkListItem' && Boolean(b.props.checked) },
          ...(textuel(b) ? {} : { content: texteDe(b.content) }),
        });
      }
    });
    return true;
  };

  /**
   * Le clavier d'une liste de cases : Entrée sur une case vide n'en ouvre pas
   * une autre ; Retour arrière en tête de case la fond dans celle du dessus,
   * et ne fait rien sur la première ; Tab ne range pas une case sous une
   * autre ; tout sélectionner prend le texte de toutes les cases.
   */
  const auClavier = (e: KeyboardEvent) => {
    // Une case ne se coche pas au clavier non plus : c'est l'agent qui dit
    // où il en est.
    if ((e.target as HTMLElement).tagName === 'INPUT' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab') {
      // ProseMirror ne la voit pas : le focus passe simplement à la suite.
      e.stopPropagation();
      return;
    }
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      // Tout sélectionner, c'est tout le texte, de la première case à la
      // dernière : effacé, il laisse une case vide.
      e.preventDefault();
      e.stopPropagation();
      const doc = editeur.document;
      editeur.setTextCursorPosition(doc[0]!, 'start');
      const debut = editeur.prosemirrorState.selection.from;
      editeur.setTextCursorPosition(doc.at(-1)!, 'end');
      const fin = editeur.prosemirrorState.selection.from;
      editeur._tiptapEditor.commands.setTextSelection({ from: debut, to: fin });
      return;
    }
    if (e.key !== 'Enter' && e.key !== 'Backspace') return;
    if (e.key === 'Enter' && e.shiftKey) {
      // Un objectif tient sur une ligne.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Une sélection de blocs (tout sélectionner) : l'éditeur s'en charge, et
    // la fiche vidée garde sa case.
    if (!('$cursor' in editeur.prosemirrorState.selection)) return;
    // Le curseur tel que la page le montre : une touche de déplacement
    // (Début, flèches) vient peut-être de le bouger sans que l'éditeur l'ait
    // encore relevé.
    const dom = window.getSelection();
    const vue = editeur.prosemirrorView;
    if (!dom?.isCollapsed || !dom.anchorNode || !vue.dom.contains(dom.anchorNode)) return;
    const position = vue.posAtDOM(dom.anchorNode, dom.anchorOffset);
    if (position !== editeur.prosemirrorState.selection.from) {
      editeur._tiptapEditor.commands.setTextSelection(position);
    }
    const selection = editeur.prosemirrorState.selection;
    if (!selection.empty) return;
    const { block, prevBlock } = editeur.getTextCursorPosition();
    const ici = texteDe(block.content);
    if (e.key === 'Enter') {
      if (!ici.trim()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (selection.$from.parentOffset > 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (!prevBlock) return;
    const dessus = texteDe(prevBlock.content);
    editeur.transact(() => {
      editeur.updateBlock(prevBlock, { content: dessus + ici });
      editeur.removeBlocks([block]);
    });
    // Le curseur à la jointure des deux textes.
    editeur.setTextCursorPosition(prevBlock, 'end');
    if (ici) {
      editeur._tiptapEditor.commands.setTextSelection(
        editeur.prosemirrorState.selection.from - ici.length,
      );
    }
  };

  return (
    <>
      {couleurs ? <style>{couleurs}</style> : null}
      <div
        data-statuts={statuts ? portee : undefined}
        className={cn(modifiable && 'cursor-text', statuts && 'fiche-statuts')}
        onKeyDownCapture={modifiable ? auClavier : undefined}
        // Comme sur une page : cliquer sous le texte place le curseur en fin
        // de liste, au lieu de ne rien faire.
        onMouseDown={(e) => {
          if (!modifiable || e.target !== e.currentTarget) return;
          e.preventDefault();
          ecrireALaFin();
        }}
      >
        <BlockNoteView
          editor={editeur}
          editable={modifiable}
          // Le clair et le sombre de la plateforme, pas ceux du système : les
          // couleurs elles-mêmes viennent des variables (globals.css).
          theme={theme === 'sombre' ? 'dark' : 'light'}
          // Ni poignée, ni menu, ni barre : une liste de cases, au clavier.
          sideMenu={false}
          slashMenu={false}
          formattingToolbar={false}
          linkToolbar={false}
          emojiPicker={false}
          onChange={() => {
            if (enPose.current) return;
            if (modifiable && normaliser()) return;
            onChange(editeur.document as unknown as Record<string, unknown>[]);
          }}
        />
      </div>
    </>
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
 * Les formations à suivre, en badges. Le n+1 voit celles que l'agent n'a pas
 * encore obtenues, commencées ou non, et choisit d'un clic ; l'agent lit
 * celles qui lui sont demandées, chacune mène à sa page.
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

  // Le catalogue, et ce qui en a été retiré depuis qu'on l'a demandé ; sans
  // ce que l'agent a déjà obtenu.
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
