'use client';

import '@blocknote/mantine/style.css';
import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  filterSuggestionItems,
} from '@blocknote/core';
import { fr } from '@blocknote/core/locales';
import { BlockNoteView } from '@blocknote/mantine';
import {
  createReactBlockSpec,
  createReactInlineContentSpec,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useEditorState,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { FormationDeLaFiche, FormationProposable } from '@teranga/contracts';
import { cn } from '@teranga/ui';
import { PastilleEtat } from './academy-equipe';
import { Icon, type IconName } from './icons';
import { usePreferences } from './preferences';

/* ————————————————————————————————————————————————————————————————
   La fiche d'objectifs d'un semestre — un éditeur de blocs, à la manière de
   Notion, réduit à ce qu'une fiche demande : des objectifs à cocher, du
   gras, de l'italique, du souligné. Le titre n'est pas à écrire : la page le
   pose (« Objectifs du 1er semestre de 2026 »). Le reste (listes « - »,
   citations « > », annuler, coller du texte mis en forme) reste au clavier,
   sans menu. Et deux blocs propres à la fiche :

   — l'ÉCHÉANCE : une date posée dans le texte, qui se lit en pastille et se
     colore quand elle approche ou qu'elle est passée. « / Échéance », ou
     « @ » pour choisir d'un mot (demain, fin du mois, fin de l'année…) ;
   — la FORMATION : un bloc qui cite une formation de l'APIX Academy et dit
     où en est l'agent — à commencer, en cours, certifiée.

   Le n+1 rédige ; l'agent lit la même fiche, sans rien pouvoir y changer.
   ———————————————————————————————————————————————————————————————— */

/** Ce que les blocs lisent autour d'eux : l'avancement de l'agent, le catalogue. */
interface ContexteFiche {
  formations: FormationDeLaFiche[];
  catalogue: FormationProposable[];
  /** Lu par l'agent : une formation mène à sa page dans l'Academy. */
  lienAcademy: boolean;
}
const Contexte = createContext<ContexteFiche>({
  formations: [],
  catalogue: [],
  lienAcademy: false,
});

function iso(d: Date): string {
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLisible(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ———————————————————————————— l'échéance

function PuceEcheance({
  date,
  modifiable,
  onChange,
}: {
  date: string;
  modifiable: boolean;
  onChange: (date: string) => void;
}) {
  const champ = useRef<HTMLInputElement>(null);
  const aujourdhui = iso(new Date());
  const dans7 = iso(new Date(Date.now() + 7 * 86_400_000));
  const passee = Boolean(date) && date < aujourdhui;
  const proche = Boolean(date) && !passee && date <= dans7;

  // Tout juste insérée sans date : le calendrier s'ouvre de lui-même.
  useEffect(() => {
    if (!date && modifiable) {
      try {
        champ.current?.showPicker();
      } catch {
        // Le navigateur exige un geste : la pastille reste là, un clic l'ouvre.
      }
    }
    // Une seule fois, à l'insertion.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="relative inline-flex align-baseline" contentEditable={false}>
      <button
        type="button"
        disabled={!modifiable}
        onClick={() => {
          try {
            champ.current?.showPicker();
          } catch {
            champ.current?.focus();
          }
        }}
        title={passee ? 'Échéance dépassée' : 'Échéance'}
        className={cn(
          // Plus basse que la ligne (16 px contre 18,75) : la pastille ne
          // l'agrandit pas, et la case à cocher reste en face du texte.
          'mx-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0 text-[0.9em] leading-4 font-semibold whitespace-nowrap ring-1 ring-inset transition-colors',
          passee
            ? 'bg-danger-soft text-danger ring-danger/20'
            : proche
              ? 'bg-accent-soft text-accent-text ring-accent/25'
              : date
                ? 'bg-primary-soft text-primary ring-primary/15'
                : 'bg-line-soft text-ink-muted ring-line',
          modifiable ? 'cursor-pointer hover:brightness-95' : 'cursor-default',
        )}
      >
        <Icon name="event" size={13} />
        {date ? dateLisible(date) : 'Choisir une date'}
      </button>
      {modifiable ? (
        <input
          ref={champ}
          type="date"
          tabIndex={-1}
          aria-label="Date de l'échéance"
          value={date}
          onChange={(e) => onChange(e.target.value)}
          className="pointer-events-none absolute inset-0 opacity-0"
        />
      ) : null}
    </span>
  );
}

const Echeance = createReactInlineContentSpec(
  { type: 'echeance', propSchema: { date: { default: '' } }, content: 'none' },
  {
    render: ({ inlineContent, updateInlineContent, editor }) => (
      <PuceEcheance
        date={inlineContent.props.date}
        modifiable={editor.isEditable}
        onChange={(date) => updateInlineContent({ type: 'echeance', props: { date } })}
      />
    ),
  },
);

// ———————————————————————————— la formation

function CarteFormation({
  courseId,
  titre,
  modifiable,
  onChoisir,
}: {
  courseId: string;
  titre: string;
  modifiable: boolean;
  onChoisir: (courseId: string, titre: string) => void;
}) {
  const { formations, catalogue, lienAcademy } = useContext(Contexte);
  const suivi = formations.find((f) => f.courseId === courseId);

  if (!courseId) {
    return (
      <div
        contentEditable={false}
        className="my-1 flex w-full items-center gap-3 rounded-[12px] border border-dashed border-line bg-surface-raised px-3.5 py-3"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/[0.08] text-primary">
          <Icon name="school" size={19} />
        </span>
        {modifiable ? (
          <select
            aria-label="Formation de l'APIX Academy"
            value=""
            onChange={(e) => {
              const choisie = catalogue.find((c) => c.id === e.target.value);
              if (choisie) onChoisir(choisie.id, choisie.title);
            }}
            className="min-w-0 flex-1 cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] text-ink outline-none focus:border-primary"
          >
            <option value="">Choisir une formation de l’APIX Academy…</option>
            {catalogue.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[13px] text-ink-muted">Formation à préciser</span>
        )}
      </div>
    );
  }

  const nom = titre || catalogue.find((c) => c.id === courseId)?.title || 'Formation';
  const contenu = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-primary/[0.08] text-primary">
        <Icon name="school" size={19} />
      </span>
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate text-[13.5px] font-semibold text-ink-strong">{nom}</span>
        <span className="mt-0.5 block text-[11.5px] text-ink-muted">
          Formation APIX Academy
          {suivi && suivi.lecons > 0 ? ` · ${suivi.validees}/${suivi.lecons} leçons` : ''}
        </span>
      </span>
      <PastilleEtat statut={suivi?.statut ?? 'a_commencer'} className="shrink-0" />
    </>
  );

  return (
    <div contentEditable={false} className="my-1 w-full">
      {lienAcademy ? (
        <Link
          href={`/academy/${courseId}`}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-card-line bg-surface px-3.5 py-3 transition-colors hover:border-card-line-hover hover:bg-hover"
        >
          {contenu}
          <Icon name="chevron_right" size={16} className="shrink-0 text-ink-muted/60" />
        </Link>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-card-line bg-surface px-3.5 py-3">
          {contenu}
          {modifiable ? (
            <button
              type="button"
              onClick={() => onChoisir('', '')}
              className="shrink-0 rounded-full px-2 py-1 text-[11.5px] font-semibold text-ink-muted transition-colors hover:bg-hover hover:text-ink"
            >
              Changer
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

const Formation = createReactBlockSpec(
  {
    type: 'formation',
    propSchema: { courseId: { default: '' }, titre: { default: '' } },
    content: 'none',
  },
  {
    render: ({ block, editor }) => (
      <CarteFormation
        courseId={block.props.courseId}
        titre={block.props.titre}
        modifiable={editor.isEditable}
        onChoisir={(courseId, titre) =>
          editor.updateBlock(block, { type: 'formation', props: { courseId, titre } })
        }
      />
    ),
  },
);

// ———————————————————————————— le schéma

/**
 * Les blocs d'une fiche. Pas de titre — la page titre chaque semestre — ni
 * d'image, de vidéo, de son ou de fichier : une fiche d'objectifs n'en a pas
 * besoin, et chacun demanderait où le stocker.
 */
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    checkListItem: defaultBlockSpecs.checkListItem,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    toggleListItem: defaultBlockSpecs.toggleListItem,
    quote: defaultBlockSpecs.quote,
    table: defaultBlockSpecs.table,
    divider: defaultBlockSpecs.divider,
    formation: Formation(),
  },
  inlineContentSpecs: { ...defaultInlineContentSpecs, echeance: Echeance },
});
type Editeur = typeof schema.BlockNoteEditor;

type Bloc = Record<string, unknown> & { type?: unknown; content?: unknown; children?: unknown };

/**
 * Les fiches rédigées quand l'éditeur avait encore des titres les gardent
 * lisibles : un titre y devient un paragraphe en gras — l'éditeur, qui ne
 * connaît plus ce bloc, refuserait sinon d'ouvrir la fiche.
 */
function sansTitres(blocs: Bloc[]): Bloc[] {
  return blocs.map((b) => {
    const enfants = Array.isArray(b.children) ? sansTitres(b.children as Bloc[]) : [];
    if (b.type !== 'heading') return { ...b, children: enfants };
    const contenu = Array.isArray(b.content)
      ? (b.content as Bloc[]).map((c) =>
          c.type === 'text'
            ? { ...c, styles: { ...(c.styles as Record<string, unknown>), bold: true } }
            : c,
        )
      : [];
    return { id: b.id, type: 'paragraph', props: {}, content: contenu, children: enfants };
  });
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
 * Le menu « / » : la liste de tâches, sans ligne d'explication ni raccourci —
 * pour repartir sur des cases à cocher après un paragraphe. « /tâche »,
 * « /obj » la retrouvent aussi.
 */
const ENTREES_SLASH: Record<string, { titre: string; icone: IconName; alias: string[] }> = {
  check_list: {
    titre: 'Liste de tâches',
    icone: 'checklist',
    alias: ['tache', 'tâche', 'objectif', 'case', 'cocher', 'todo'],
  },
};

function entreesSlash(editeur: Editeur): DefaultReactSuggestionItem[] {
  return getDefaultReactSlashMenuItems(editeur).flatMap((e) => {
    const entree = ENTREES_SLASH[(e as { key?: string }).key ?? ''];
    if (!entree) return [];
    return [
      {
        ...e,
        title: entree.titre,
        aliases: [...(e.aliases ?? []), ...entree.alias],
        icon: <Icon name={entree.icone} size={18} />,
        subtext: undefined,
        badge: undefined,
        group: undefined,
      },
    ];
  });
}

// ———————————————————————————— la barre de mise en forme

const STYLES: { style: 'bold' | 'italic' | 'underline'; libelle: string; icone: IconName }[] = [
  { style: 'bold', libelle: 'Gras', icone: 'format_bold' },
  { style: 'italic', libelle: 'Italique', icone: 'format_italic' },
  { style: 'underline', libelle: 'Souligné', icone: 'format_underlined' },
];

/** Un bouton de style : ni infobulle ni raccourci — B, I, U se lisent seuls. */
function BoutonStyle({ style, libelle, icone }: (typeof STYLES)[number]) {
  const Composants = useComponentsContext()!;
  const editeur = useBlockNoteEditor(schema);
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
 * La barre qui paraît sur une sélection : trois boutons. Pas de type de bloc,
 * de couleur, d'alignement ni de lien — une fiche d'objectifs n'en a pas
 * besoin. En lecture (l'agent), ou sur une formation sélectionnée (un bloc
 * sans texte), rien à mettre en forme : pas de barre.
 */
function BarreDeMiseEnForme() {
  const editeur = useBlockNoteEditor(schema);
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

/** « @ » : une échéance en un mot. */
function datesProposees(editeur: Editeur): DefaultReactSuggestionItem[] {
  const j = new Date();
  const le = (d: Date) => iso(d);
  const plus = (n: number) => new Date(j.getFullYear(), j.getMonth(), j.getDate() + n);
  const finDuMois = new Date(j.getFullYear(), j.getMonth() + 1, 0);
  const finDuTrimestre = new Date(j.getFullYear(), Math.floor(j.getMonth() / 3) * 3 + 3, 0);
  const finDAnnee = new Date(j.getFullYear(), 11, 31);
  const poser = (date: string) => () =>
    editeur.insertInlineContent([{ type: 'echeance', props: { date } }, ' ']);
  const entree = (title: string, d: Date | null, aliases: string[]) => ({
    title,
    subtext: d ? dateLisible(le(d)) : 'Dans le calendrier',
    aliases,
    group: 'Échéance',
    icon: <Icon name="event" size={18} />,
    onItemClick: poser(d ? le(d) : ''),
  });
  return [
    entree('Aujourd’hui', j, ['aujourdhui', 'today']),
    entree('Demain', plus(1), ['demain']),
    entree('Dans une semaine', plus(7), ['semaine']),
    entree('Dans deux semaines', plus(14), ['quinzaine']),
    entree('Fin du mois', finDuMois, ['mois']),
    entree('Fin du trimestre', finDuTrimestre, ['trimestre']),
    entree('Fin de l’année', finDAnnee, ['annee', 'année', 'decembre']),
    entree('Choisir une date…', null, ['date', 'calendrier']),
  ];
}

// ———————————————————————————— l'éditeur

export function EditeurFicheObjectifs({
  contenu,
  modifiable,
  formations,
  catalogue = [],
  onChange,
  focusSignal = 0,
  className,
}: {
  contenu: Record<string, unknown>[];
  modifiable: boolean;
  formations: FormationDeLaFiche[];
  catalogue?: FormationProposable[];
  onChange?: (blocs: Record<string, unknown>[]) => void;
  /** Chaque changement ramène le curseur en fin de fiche (« Fixer des objectifs »). */
  focusSignal?: number;
  /** La marge autour du texte : un clic dedans, et l'on écrit en fin de fiche. */
  className?: string;
}) {
  const { theme } = usePreferences();
  const editeur = useCreateBlockNote({
    schema,
    dictionary: dictionnaire,
    initialContent: (contenu.length ? sansTitres(contenu) : FICHE_NEUVE) as unknown as NonNullable<
      Parameters<typeof useCreateBlockNote>[0]
    >['initialContent'],
  });

  /** Le curseur au bout de la fiche : c'est là qu'on ajoute. */
  const ecrireALaFin = useCallback(() => {
    const dernier = editeur.document.at(-1);
    if (!dernier) return;
    // Une formation n'a pas de texte où poser le curseur : une ligne s'ouvre
    // sous elle.
    const cible =
      dernier.content === undefined
        ? editeur.insertBlocks([{ type: 'paragraph' }], dernier, 'after')[0]!
        : dernier;
    editeur.setTextCursorPosition(cible, 'end');
    editeur.focus();
  }, [editeur]);

  useEffect(() => {
    if (focusSignal > 0 && modifiable) ecrireALaFin();
  }, [focusSignal, modifiable, ecrireALaFin]);

  const contexte = useMemo(
    () => ({ formations, catalogue, lienAcademy: !modifiable }),
    [formations, catalogue, modifiable],
  );

  return (
    <Contexte.Provider value={contexte}>
      <div
        className={cn(modifiable && 'cursor-text', className)}
        // Comme sur une page : cliquer sous le texte place le curseur en fin
        // de fiche, au lieu de ne rien faire.
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
          // Ni poignée de déplacement ni « + » en marge : la fiche s'écrit au
          // clavier, comme un texte. Pas d'émojis au « : » — en français, il
          // suit chaque intitulé (« Objectif : … »).
          sideMenu={false}
          slashMenu={false}
          formattingToolbar={false}
          emojiPicker={false}
          onChange={() => onChange?.(editeur.document as unknown as Record<string, unknown>[])}
          className="fiche-objectifs"
        >
          <FormattingToolbarController formattingToolbar={BarreDeMiseEnForme} />
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (requete) => filterSuggestionItems(entreesSlash(editeur), requete)}
          />
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (requete) => filterSuggestionItems(datesProposees(editeur), requete)}
          />
        </BlockNoteView>
      </div>
    </Contexte.Provider>
  );
}
