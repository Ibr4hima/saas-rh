'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  decouperTexte,
  type ReferenceChapterView,
  type ReferenceSearchHit,
  type ReferenceTextView,
} from '@teranga/contracts';
import Link from 'next/link';
import { Button, Card, CardContent, cn, EmptyState, Input, Skeleton } from '@teranga/ui';
import { api, apiUrl } from '../lib/api';
import { useMe } from '../lib/hooks';
import { FenetreDocument } from './fenetre-document';
import { Icon } from './icons';

/**
 * La lecture d'un texte de référence — code du travail, règlement intérieur.
 *
 * Un texte de loi ne se lit pas comme une page : on y ENTRE par un chapitre ou
 * par un mot, rarement par le début. L'écran tient donc sur trois gestes — le
 * sommaire à gauche, qui est la carte du texte ; la recherche, qui rend des
 * articles et non des pages ; et le fichier officiel, à un clic, parce que lui
 * seul fait foi.
 *
 * Aucun fragment de HTML ne traverse cet écran. Le corps des articles est du
 * texte brut découpé ici même en paragraphes et en listes (`decouperTexte`),
 * et le surlignage des trouvailles est posé sur des marques convenues plutôt
 * que sur des balises reçues du serveur.
 */
export function LecteurReference({ slug }: { slug: string }) {
  const me = useMe();
  const peutDeposer = Boolean(me.data && ['admin', 'hr'].includes(me.data.role));
  const texte = useQuery({
    queryKey: ['reference-text', slug],
    queryFn: () => api<ReferenceTextView>(`/reference-texts/${slug}`),
    retry: false,
  });

  const [chapitreId, setChapitreId] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [saisie, setSaisie] = useState('');
  const [pdfOuvert, setPdfOuvert] = useState(false);
  /** L'article à rejoindre après un clic sur un résultat de recherche. */
  const [cible, setCible] = useState<string | null>(null);

  const chapitres = useMemo(() => texte.data?.chapters ?? [], [texte.data]);
  // Le premier chapitre s'ouvre dès que le texte est là ; changer de texte
  // remet la lecture à zéro.
  useEffect(() => {
    setChapitreId(null);
    setSectionId(null);
    setSaisie('');
  }, [slug]);
  useEffect(() => {
    const premier = chapitres[0];
    if (premier) setChapitreId((c) => c ?? premier.id);
  }, [chapitres]);

  // La recherche ne part qu'après une pause dans la frappe : une requête par
  // lettre ferait dix allers-retours pour un mot de dix caractères.
  const [requete, setRequete] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setRequete(saisie.trim()), 300);
    return () => clearTimeout(t);
  }, [saisie]);

  const recherche = useQuery({
    queryKey: ['reference-search', slug, requete],
    queryFn: () =>
      api<ReferenceSearchHit[]>(
        `/reference-texts/${slug}/recherche?q=${encodeURIComponent(requete)}`,
      ),
    enabled: requete.length >= 2,
  });
  const enRecherche = requete.length >= 2;

  // Après un clic sur un résultat : rejoindre l'article et le faire clignoter
  // — sans quoi on retombe en haut d'un chapitre de trente articles.
  useEffect(() => {
    if (!cible || enRecherche) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`article-${cible}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('ring-2', 'ring-primary/40');
      setTimeout(() => el?.classList.remove('ring-2', 'ring-primary/40'), 1600);
      setCible(null);
    }, 80);
    return () => clearTimeout(t);
  }, [cible, chapitreId, enRecherche]);

  if (texte.isLoading) return <Squelette />;
  if (texte.isError || !texte.data) {
    return (
      <Card>
        <EmptyState
          className="py-16"
          icon={<Icon name="gavel" size={22} />}
          title="Ce texte n’a pas encore été déposé"
          description={
            peutDeposer
              ? 'Collez le texte en vigueur et joignez son fichier officiel : chacun pourra ensuite le consulter depuis son espace.'
              : 'La Direction du Capital Humain dépose ici le texte en vigueur et son fichier officiel.'
          }
          action={
            peutDeposer ? (
              <Link href={`/reglementations/${slug}/deposer`}>
                <Button size="sm">
                  <Icon name="add" size={15} />
                  Déposer le texte
                </Button>
              </Link>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const t = texte.data;
  const chapitre = chapitres.find((c) => c.id === chapitreId) ?? chapitres[0] ?? null;
  const rang = chapitres.findIndex((c) => c.id === chapitre?.id);

  const allerAuChapitre = (id: string) => {
    setChapitreId(id);
    setSectionId(null);
    setSaisie('');
    document.getElementById('lecture')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex flex-col gap-4">
      <Enseigne
        texte={t}
        saisie={saisie}
        onSaisie={setSaisie}
        onOuvrirPdf={() => setPdfOuvert(true)}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[268px_minmax(0,1fr)]">
        <Sommaire
          chapitres={chapitres}
          chapitreId={chapitre?.id ?? null}
          sectionId={sectionId}
          onChapitre={allerAuChapitre}
          onSection={(cid, sid) => {
            setChapitreId(cid);
            setSectionId(sid);
            setSaisie('');
          }}
        />

        <Card id="lecture" className="scroll-mt-4">
          <CardContent className="px-6 py-8 sm:px-10 sm:py-10">
            {enRecherche ? (
              <Resultats
                requete={requete}
                hits={recherche.data ?? []}
                enCours={recherche.isFetching}
                onOuvrir={(hit) => {
                  setChapitreId(hit.chapterId);
                  setSectionId(null);
                  setSaisie('');
                  setCible(hit.id);
                }}
              />
            ) : chapitre ? (
              <>
                <Chapitre chapitre={chapitre} sectionId={sectionId} />
                <Pagination
                  precedent={(rang > 0 ? chapitres[rang - 1] : null) ?? null}
                  suivant={chapitres[rang + 1] ?? null}
                  onAller={allerAuChapitre}
                />
              </>
            ) : (
              <p className="py-10 text-center text-[13px] text-ink-muted">
                Ce texte n’a pas encore de contenu.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {pdfOuvert && t.pdf ? (
        <FenetreDocument
          doc={{
            url: apiUrl(`/reference-texts/${slug}/pdf?disposition=inline`),
            filename: t.pdf.filename,
            contentType: 'application/pdf',
            titre: `${t.title} — texte officiel`,
          }}
          sousTitre={t.reference}
          onClose={() => setPdfOuvert(false)}
        />
      ) : null}
    </div>
  );
}

/** L'identité du texte et les deux outils qui servent à le parcourir. */
function Enseigne({
  texte,
  saisie,
  onSaisie,
  onOuvrirPdf,
}: {
  texte: ReferenceTextView;
  saisie: string;
  onSaisie: (v: string) => void;
  onOuvrirPdf: () => void;
}) {
  // Deux lignes, et deux natures : ce que le texte EST — sa référence, sa date
  // d'entrée en vigueur — puis ce qu'il PÈSE. Tout mettre sur une ligne faisait
  // un paragraphe qu'on ne lit pas.
  const identite = [
    texte.reference,
    texte.effectiveOn ? `en vigueur depuis le ${dateLongue(texte.effectiveOn)}` : null,
  ].filter(Boolean) as string[];
  const mesures = [
    `${texte.chapters.length} chapitre${texte.chapters.length > 1 ? 's' : ''}`,
    `${texte.articleCount} article${texte.articleCount > 1 ? 's' : ''}`,
  ];

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-primary/[0.10] text-primary">
          <Icon name="gavel" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2.5 text-[15px] leading-tight font-extrabold text-ink-strong">
            {texte.title}
            <span className="text-[11px] font-semibold text-ink-muted">{mesures.join(' · ')}</span>
          </p>
          {identite.length > 0 ? (
            <p className="mt-1 text-[11.5px] leading-snug text-ink-muted">{identite.join(' · ')}</p>
          ) : null}
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <span className="relative flex-1 sm:w-64 sm:flex-none">
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
            />
            <Input
              value={saisie}
              onChange={(e) => onSaisie(e.target.value)}
              placeholder="Rechercher un article…"
              aria-label={`Rechercher dans ${texte.title}`}
              className="pl-9"
            />
          </span>
          {texte.pdf ? (
            <button
              type="button"
              onClick={onOuvrirPdf}
              title="Ouvrir le texte officiel"
              aria-label="Ouvrir le texte officiel"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-card-line bg-surface text-ink-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              <Icon name="description" size={17} />
            </button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Le sommaire : la carte du texte, et le seul endroit d'où l'on navigue. */
function Sommaire({
  chapitres,
  chapitreId,
  sectionId,
  onChapitre,
  onSection,
}: {
  chapitres: ReferenceChapterView[];
  chapitreId: string | null;
  sectionId: string | null;
  onChapitre: (id: string) => void;
  onSection: (chapitreId: string, sectionId: string | null) => void;
}) {
  return (
    <Card className="h-fit lg:sticky lg:top-4">
      <CardContent className="px-2 py-3">
        <p className="px-3 pb-2 text-[9.5px] font-extrabold tracking-[0.14em] text-ink-muted uppercase">
          Sommaire
        </p>
        <nav className="flex flex-col">
          {chapitres.map((c) => {
            const actif = c.id === chapitreId;
            return (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => onChapitre(c.id)}
                  aria-current={actif ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-baseline gap-2.5 rounded-[10px] border-l-[3px] px-2.5 py-2 text-left transition-colors',
                    actif
                      ? 'border-primary bg-primary/[0.06]'
                      : 'border-transparent hover:bg-hover',
                  )}
                >
                  {/* Le chiffre romain fait office de repère de rang : on
                      retrouve « le chapitre IV » sans relire tous les titres. */}
                  <span
                    className={cn(
                      'w-5 shrink-0 text-[10px] font-extrabold tabular-nums',
                      actif ? 'text-primary' : 'text-ink-muted',
                    )}
                  >
                    {c.numero.replace(/^Chapitre\s+/, '').replace('premier', 'I')}
                  </span>
                  <span
                    className={cn(
                      'text-[12px] leading-snug',
                      actif ? 'font-bold text-ink-strong' : 'font-medium text-ink',
                    )}
                  >
                    {c.title}
                  </span>
                </button>

                {actif && c.sections.length > 0 ? (
                  <div className="mt-0.5 mb-1.5 ml-8 flex flex-col">
                    {c.sections.map((s) => {
                      const choisie = sectionId === s.id;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onSection(c.id, choisie ? null : s.id)}
                          className={cn(
                            'border-l py-1.5 pl-3 text-left text-[11.5px] leading-snug transition-colors',
                            choisie
                              ? 'border-primary font-semibold text-primary'
                              : 'border-line text-ink-muted hover:text-ink',
                          )}
                        >
                          {s.title}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </CardContent>
    </Card>
  );
}

/** Un chapitre : son en-tête, ses sections traversées, ses articles. */
function Chapitre({
  chapitre,
  sectionId,
}: {
  chapitre: ReferenceChapterView;
  sectionId: string | null;
}) {
  const articles = sectionId
    ? chapitre.articles.filter((a) => a.sectionId === sectionId)
    : chapitre.articles;

  return (
    <>
      <header className="mb-9 text-center">
        <p className="text-[10.5px] font-extrabold tracking-[0.2em] text-primary uppercase">
          {chapitre.numero}
        </p>
        <h2 className="mt-2.5 text-[1.55rem] leading-tight font-extrabold tracking-[-0.02em] text-ink-strong">
          {chapitre.title}
        </h2>
        <span aria-hidden className="mx-auto mt-4 block h-[3px] w-10 rounded-full bg-primary" />
        {chapitre.body && !sectionId ? (
          <div className="mt-5 text-left">
            <Corps texte={chapitre.body} />
          </div>
        ) : null}
      </header>

      {articles.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-muted">
          Aucun article dans cette section.
        </p>
      ) : (
        articles.map((a, i) => {
          // Le titre d'une section ne s'annonce qu'à son premier article :
          // le répéter à chacun ferait un intertitre tous les paragraphes.
          const precedent = i > 0 ? articles[i - 1] : null;
          const ouvre =
            !sectionId && a.sectionId && (!precedent || precedent.sectionId !== a.sectionId);
          const section = ouvre ? chapitre.sections.find((s) => s.id === a.sectionId) : null;
          return (
            <div key={a.id}>
              {section ? (
                <div className="mt-10 mb-7 border-b border-line pb-3 first:mt-0">
                  <p className="text-[10px] font-extrabold tracking-[0.14em] text-primary uppercase">
                    {section.numero}
                  </p>
                  <p className="mt-1 text-[15px] font-bold text-ink-strong">{section.title}</p>
                  {section.body ? <Corps texte={section.body} /> : null}
                </div>
              ) : null}

              <article
                id={`article-${a.id}`}
                className="mb-7 scroll-mt-6 rounded-[10px] transition-shadow"
              >
                <p className="mb-2 text-[14px] leading-snug font-bold text-ink-strong">
                  <span className="text-primary">Article {a.numero}</span>
                  {a.title ? <span className="font-semibold text-ink"> — {a.title}</span> : null}
                </p>
                <Corps texte={a.body} />
              </article>
            </div>
          );
        })
      )}
    </>
  );
}

/**
 * Le corps d'un article, rendu depuis du TEXTE BRUT.
 *
 * Pas de `dangerouslySetInnerHTML` : le serveur ne renvoie aucun balisage, et
 * une session RH compromise ne peut donc rien injecter dans l'écran des
 * employés. La mise en forme se déduit de la frappe — ligne vide, tiret — et
 * c'est nous qui posons les balises.
 */
function Corps({ texte }: { texte: string }) {
  const blocs = useMemo(() => decouperTexte(texte), [texte]);
  if (blocs.length === 0) {
    return <p className="text-[13px] text-ink-muted/70">Contenu non renseigné.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {blocs.map((b, i) =>
        b.type === 'liste' ? (
          <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5">
            {b.items.map((item, j) => (
              <li key={j} className="text-[13.5px] leading-[1.75] text-ink">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-[13.5px] leading-[1.8] text-ink">
            {b.texte}
          </p>
        ),
      )}
    </div>
  );
}

/** Les trouvailles : des ARTICLES, jamais des pages. */
function Resultats({
  requete,
  hits,
  enCours,
  onOuvrir,
}: {
  requete: string;
  hits: ReferenceSearchHit[];
  enCours: boolean;
  onOuvrir: (hit: ReferenceSearchHit) => void;
}) {
  return (
    <div>
      <p className="mb-5 text-[10px] font-extrabold tracking-[0.14em] text-ink-muted uppercase">
        {enCours
          ? 'Recherche…'
          : `${hits.length} résultat${hits.length > 1 ? 's' : ''} pour « ${requete} »`}
      </p>
      {!enCours && hits.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-muted">
          Aucun article ne contient ce terme.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {hits.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => onOuvrir(h)}
            className="rounded-[12px] border border-card-line bg-bg px-4 py-3 text-left transition-all hover:-translate-y-px hover:border-primary/40 hover:bg-surface hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >
            <p className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
              {h.chapterNumero} · {h.chapterTitle}
            </p>
            <p className="mt-1 flex items-center justify-between gap-3 text-[12.5px] font-bold text-primary">
              <span>
                Article {h.numero}
                {h.title ? <span className="text-ink-strong"> — {h.title}</span> : null}
              </span>
              <Icon name="chevron_right" size={14} className="shrink-0 text-ink-muted" />
            </p>
            <p className="mt-1.5 text-[12.5px] leading-[1.7] text-ink-muted">
              <Surligne extrait={h.extract} />
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Le surlignage des mots trouvés.
 *
 * Le serveur marque la trouvaille par des crochets doubles, pas par des
 * balises : on découpe sur ces marques et on pose nous-mêmes le `<mark>`.
 * Aucun HTML ne traverse la frontière, donc aucune injection possible depuis
 * le contenu d'un article.
 */
function Surligne({ extrait }: { extrait: string }) {
  const morceaux = extrait.split(/\[\[|\]\]/);
  return (
    <>
      {morceaux.map((m, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-primary/[0.14] px-0.5 font-semibold text-ink-strong">
            {m}
          </mark>
        ) : (
          <span key={i}>{m}</span>
        ),
      )}
    </>
  );
}

/**
 * « le 1er décembre 1997 », jamais « le 1 décembre ».
 *
 * `toLocaleDateString` rend « 1 » pour le premier du mois : c'est juste en
 * chiffres, faux en toutes lettres. La date d'entrée en vigueur d'une loi
 * s'écrit comme la loi elle-même l'écrit.
 */
function dateLongue(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  const jour = d.getDate();
  const reste = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return `${jour === 1 ? '1er' : jour} ${reste}`;
}

function Squelette() {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="py-5">
          <Skeleton className="h-9 w-full" />
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[268px_minmax(0,1fr)]">
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-4 px-10 py-10">
            <Skeleton className="mx-auto h-6 w-72" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** D'un chapitre au suivant, sans repasser par le sommaire. */
function Pagination({
  precedent,
  suivant,
  onAller,
}: {
  precedent: ReferenceChapterView | null;
  suivant: ReferenceChapterView | null;
  onAller: (id: string) => void;
}) {
  if (!precedent && !suivant) return null;
  const Bouton = ({ chap, sens }: { chap: ReferenceChapterView; sens: 'avant' | 'apres' }) => (
    <button
      type="button"
      onClick={() => onAller(chap.id)}
      className={cn(
        'flex flex-1 items-center gap-3 rounded-[12px] border border-card-line px-4 py-3 transition-colors',
        'hover:border-primary/40 hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
      )}
    >
      {sens === 'avant' ? (
        <Icon name="chevron_left" size={16} className="shrink-0 text-primary" />
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[9.5px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
          {sens === 'avant' ? 'Chapitre précédent' : 'Chapitre suivant'}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] font-bold text-ink-strong">
          {chap.title}
        </span>
      </span>
      {sens === 'apres' ? (
        <Icon name="chevron_right" size={16} className="shrink-0 text-primary" />
      ) : null}
    </button>
  );
  return (
    <div className="mt-10 flex gap-3 border-t border-line pt-6">
      {precedent ? <Bouton chap={precedent} sens="avant" /> : <span className="flex-1" />}
      {suivant ? <Bouton chap={suivant} sens="apres" /> : <span className="flex-1" />}
    </div>
  );
}
