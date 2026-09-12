'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyserTexte,
  composerTexte,
  MAX_REFERENCE_PDF_BYTES,
  REFERENCE_TEXT_TITLES,
  type ReferenceTextSlug,
  type ReferenceTextView,
  type SaveReferenceTextInput,
} from '@teranga/contracts';
import { Button, Card, CardContent, Checkbox, Field, Input, Skeleton, Textarea } from '@teranga/ui';
import { api, ApiError } from '../../../../../lib/api';
import { useMe } from '../../../../../lib/hooks';
import { Icon } from '../../../../../components/icons';

/**
 * Déposer un texte de référence.
 *
 * Le geste réel de la RH n'est pas « créer un article » trois cents fois :
 * c'est COLLER un texte reçu en PDF ou en Word, vérifier qu'il a été compris,
 * et joindre le fichier officiel. L'écran suit ce geste — une zone de collage,
 * un compte rendu de lecture immédiat, un fichier, et un seul bouton.
 *
 * Le texte se ré-affiche tel qu'on le collerait : reprendre une version, c'est
 * rouvrir la même zone, pas retrouver trois cents formulaires.
 */
export default function DeposerTextePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const peutDeposer = Boolean(me.data && ['admin', 'hr'].includes(me.data.role));

  const existant = useQuery({
    queryKey: ['reference-text', slug],
    queryFn: () => api<ReferenceTextView>(`/reference-texts/${slug}`),
    retry: false,
  });

  const [titre, setTitre] = useState('');
  const [reference, setReference] = useState('');
  const [entreeEnVigueur, setEntreeEnVigueur] = useState('');
  const [publie, setPublie] = useState(false);
  const [brut, setBrut] = useState('');
  const [fichier, setFichier] = useState<{ nom: string; base64: string; taille: number } | null>(
    null,
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const prerempli = useRef(false);

  // Le formulaire se remplit UNE FOIS, à l'arrivée du texte : le refaire à
  // chaque rendu effacerait ce qu'on est en train d'écrire.
  useEffect(() => {
    if (prerempli.current) return;
    if (existant.isLoading) return;
    prerempli.current = true;
    const t = existant.data;
    setTitre(t?.title ?? REFERENCE_TEXT_TITLES[slug as ReferenceTextSlug] ?? '');
    setReference(t?.reference ?? '');
    setEntreeEnVigueur(t?.effectiveOn ?? '');
    setPublie(t?.published ?? false);
    setBrut(
      t
        ? composerTexte(
            t.chapters.map((c, i) => ({
              number: i + 1,
              title: c.title,
              body: c.body,
              sections: c.sections.map((s, j) => ({ number: j + 1, title: s.title, body: s.body })),
              articles: c.articles.map((a) => ({
                number: a.number,
                label: a.numero === String(a.number) ? null : a.numero,
                title: a.title,
                body: a.body,
                sectionNumber: a.sectionId
                  ? c.sections.findIndex((s) => s.id === a.sectionId) + 1
                  : null,
              })),
            })),
          )
        : '',
    );
  }, [existant.isLoading, existant.data, slug]);

  // L'analyse suit la frappe : on voit ce qui a été compris pendant qu'on colle.
  const analyse = useMemo(() => analyserTexte(brut), [brut]);

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps: SaveReferenceTextInput = {
        title: titre.trim(),
        reference: reference.trim() || null,
        effectiveOn: entreeEnVigueur || null,
        published: publie,
        chapters: analyse.chapters,
      };
      await api(`/reference-texts/${slug}`, { method: 'PUT', body: corps });
      // Le fichier ne part qu'APRÈS : il se dépose sur un texte qui existe.
      if (fichier) {
        await api(`/reference-texts/${slug}/pdf`, {
          method: 'POST',
          body: { filename: fichier.nom, contentBase64: fichier.base64 },
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['reference-text', slug] });
      router.push(`/reglementations/${slug}`);
    },
    onError: (err) =>
      setErreur(err instanceof ApiError ? err.message : 'Enregistrement impossible.'),
  });

  if (me.isLoading || existant.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[980px]">
        <Card>
          <CardContent className="flex flex-col gap-3 py-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!peutDeposer) {
    return (
      <div className="mx-auto w-full max-w-[980px]">
        <Card>
          <CardContent className="py-10 text-center text-[13px] text-ink-muted">
            Seule la Direction du Capital Humain dépose les textes de référence.
          </CardContent>
        </Card>
      </div>
    );
  }

  const pretAEnregistrer = titre.trim().length >= 2 && analyse.chapters.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-[980px] flex-col gap-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 py-5 sm:grid-cols-2">
          <Field label="Intitulé du texte" htmlFor="titre" required>
            <Input id="titre" value={titre} onChange={(e) => setTitre(e.target.value)} />
          </Field>
          <Field
            label="Référence"
            htmlFor="reference"
            hint="Ce qui identifie la version en vigueur — « Loi n° 97-17 du 1er décembre 1997 »."
          >
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Loi n° 97-17 du 1er décembre 1997"
            />
          </Field>
          <Field label="Entrée en vigueur" htmlFor="vigueur">
            <Input
              id="vigueur"
              type="date"
              value={entreeEnVigueur}
              onChange={(e) => setEntreeEnVigueur(e.target.value)}
            />
          </Field>
          <Field label="Publication" htmlFor="publie">
            <label className="flex items-start gap-2.5 rounded-[10px] border border-card-line px-3 py-2.5">
              <Checkbox
                id="publie"
                className="mt-0.5"
                checked={publie}
                onChange={(e) => setPublie(e.target.checked)}
              />
              <span className="text-[12.5px] leading-snug text-ink">
                Visible par tout le personnel
                <span className="mt-0.5 block text-[11.5px] text-ink-muted">
                  Tant que la case est décochée, le texte reste un brouillon que vous seule voyez.
                </span>
              </span>
            </label>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[9.5px] font-extrabold tracking-[0.14em] text-ink-muted uppercase">
              Le texte
            </p>
            <p className="text-[11.5px] text-ink-muted">
              Collez le texte tel quel. Les en-têtes se reconnaissent seuls :{' '}
              <code className="rounded bg-bg px-1 font-mono text-[11px]">CHAPITRE I — Titre</code>,{' '}
              <code className="rounded bg-bg px-1 font-mono text-[11px]">Section I — Titre</code>,{' '}
              <code className="rounded bg-bg px-1 font-mono text-[11px]">
                Article premier — Titre
              </code>
              .
            </p>
          </div>
          <Textarea
            value={brut}
            onChange={(e) => setBrut(e.target.value)}
            rows={20}
            spellCheck={false}
            aria-label="Texte à déposer"
            className="font-mono text-[12.5px] leading-[1.7]"
            placeholder={
              'CHAPITRE PREMIER — Dispositions générales\n\nArticle premier — Objet\n\nLe présent texte…'
            }
          />
          <CompteRendu analyse={analyse} />
        </CardContent>
      </Card>

      <FichierOfficiel
        actuel={existant.data?.pdf ?? null}
        choisi={fichier}
        onChoisir={setFichier}
        onErreur={setErreur}
      />

      {erreur ? (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{erreur}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => router.push(`/reglementations/${slug}`)}>
          Annuler
        </Button>
        <Button
          loading={enregistrer.isPending}
          disabled={!pretAEnregistrer}
          onClick={() => {
            setErreur(null);
            enregistrer.mutate();
          }}
        >
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

/**
 * Ce que l'analyse a compris, pendant qu'on colle.
 *
 * Un import silencieux se découvre trop tard : on enregistre trois cents
 * articles, et c'est en lisant qu'on voit que le chapitre IV a mangé le V.
 * Le compte rendu tient en une ligne quand tout va bien.
 */
function CompteRendu({ analyse }: { analyse: ReturnType<typeof analyserTexte> }) {
  const { chapters, problemes, articleCount } = analyse;
  const sections = chapters.reduce((n, c) => n + c.sections.length, 0);
  return (
    <div className="flex flex-col gap-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
        <span className="flex items-center gap-1.5 font-semibold text-ink">
          <Icon
            name={problemes.length === 0 && chapters.length > 0 ? 'check_circle' : 'error'}
            size={14}
            className={
              problemes.length === 0 && chapters.length > 0 ? 'text-success' : 'text-warning'
            }
          />
          {chapters.length} chapitre{chapters.length > 1 ? 's' : ''}
        </span>
        <span>
          {sections} section{sections > 1 ? 's' : ''}
        </span>
        <span>
          {articleCount} article{articleCount > 1 ? 's' : ''}
        </span>
      </p>
      {problemes.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md bg-warning-soft px-3 py-2">
          {problemes.map((p, i) => (
            <li key={i} className="text-[12px] leading-snug text-warning">
              {p}
            </li>
          ))}
        </ul>
      ) : null}
      {chapters.length > 0 ? (
        <details className="rounded-[10px] border border-card-line px-3 py-2">
          <summary className="cursor-pointer text-[12px] font-semibold text-ink-muted">
            Vérifier le découpage
          </summary>
          <ol className="mt-2 flex flex-col gap-1.5">
            {chapters.map((c) => (
              <li key={c.number} className="text-[12px] text-ink">
                <span className="font-bold">
                  {c.number}. {c.title}
                </span>
                <span className="text-ink-muted">
                  {' '}
                  — {c.articles.length} article{c.articles.length > 1 ? 's' : ''}
                  {c.sections.length > 0
                    ? `, ${c.sections.length} section${c.sections.length > 1 ? 's' : ''}`
                    : ''}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

/** Le fichier officiel : celui qui fait foi, à côté du texte lu. */
function FichierOfficiel({
  actuel,
  choisi,
  onChoisir,
  onErreur,
}: {
  actuel: { filename: string; size: number } | null;
  choisi: { nom: string; base64: string; taille: number } | null;
  onChoisir: (f: { nom: string; base64: string; taille: number } | null) => void;
  onErreur: (m: string | null) => void;
}) {
  const enKo = (o: number) => `${Math.max(1, Math.round(o / 1024))} Ko`;
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-bg text-ink-muted">
          <Icon name="description" size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-bold text-ink-strong">Fichier officiel</p>
          <p className="mt-0.5 text-[11.5px] text-ink-muted">
            {choisi
              ? `${choisi.nom} · ${enKo(choisi.taille)} — sera déposé à l’enregistrement`
              : actuel
                ? `${actuel.filename} · ${enKo(actuel.size)}`
                : 'Aucun fichier déposé. Le texte lu reste consultable sans lui.'}
          </p>
        </div>
        <label className="shrink-0 cursor-pointer rounded-full border border-card-line px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:border-primary/40 hover:text-primary">
          {actuel || choisi ? 'Remplacer' : 'Choisir un PDF'}
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > MAX_REFERENCE_PDF_BYTES) {
                onErreur('Le fichier doit faire 15 Mo maximum.');
                return;
              }
              const octets = new Uint8Array(await f.arrayBuffer());
              let binaire = '';
              // Par tranches : `String.fromCharCode(...tableau)` sur plusieurs
              // mégaoctets dépasse la taille de pile des arguments.
              for (let i = 0; i < octets.length; i += 8192) {
                binaire += String.fromCharCode(...octets.subarray(i, i + 8192));
              }
              onErreur(null);
              onChoisir({ nom: f.name, base64: btoa(binaire), taille: f.size });
            }}
          />
        </label>
      </CardContent>
    </Card>
  );
}
