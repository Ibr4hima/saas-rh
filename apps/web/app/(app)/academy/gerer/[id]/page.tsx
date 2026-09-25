'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type {
  CourseAdminView,
  LessonView,
  ModuleView,
  VideoUploadTarget,
} from '@teranga/contracts';
import {
  DUREE_MAX_LECON_S,
  MARGE_DUREE_S,
  MAX_SUPPORT_BYTES,
  MAX_VIDEO_LOCALE_BYTES,
} from '@teranga/contracts';
import { Badge, Button, Card, cn, Input, Skeleton } from '@teranga/ui';
import { Couverture, RetourAcademy } from '../../../../../components/academy-carte';
import { SectionEvaluation } from '../../../../../components/academy-evaluation-atelier';
import { FormationModal } from '../../../../../components/academy-formation-modal';
import { Page } from '../../../../../components/gabarit';
import { Icon } from '../../../../../components/icons';
import { LoadFailure } from '../../../../../components/load-failure';
import { FenetreDocument } from '../../../../../components/fenetre-document';
import { FenetreSuppression } from '../../../../../components/reglages-absences';
import { dureeLisible, FAMILLES, horloge } from '../../../../../lib/academy';
import { api, ApiError, apiUrl } from '../../../../../lib/api';
import { compte } from '../../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   L'atelier d'une formation.

   Tout se construit ICI, sur une seule page : les modules, leurs leçons, la
   vidéo et le support de chacune — sans fenêtre à ouvrir pour chaque geste.
   Une formation fait quelques modules et quelques dizaines de leçons : elle
   tient sous les yeux, et la RH voit d'un coup ce qui manque.

   Ce qui manque est dit en ORANGE, en tête : c'est la liste de ce qui attend
   la RH avant publication. Elle se vide à mesure qu'on dépose.

   Les vidéos partent au fil de l'eau, plusieurs à la fois si l'on veut ; la
   page prévient si on la quitte pendant un envoi.
   ———————————————————————————————————————————————————————————————— */

type Envoi = { part: number; erreur?: undefined } | { part?: undefined; erreur: string };

/** La durée d'une vidéo, lue dans le navigateur AVANT de l'envoyer. */
function lireDuree(fichier: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(fichier);
    const v = document.createElement('video');
    let fini = false;
    const fin = (d: number | null) => {
      if (fini) return;
      fini = true;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    v.preload = 'metadata';
    v.onloadedmetadata = () => fin(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => fin(null);
    setTimeout(() => fin(null), 8000);
    v.src = url;
  });
}

function minutesSecondes(s: number): string {
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;
}

/** L'envoi lui-même, avec sa progression — `fetch` ne sait pas la donner. */
function envoyerFichier(
  cible: VideoUploadTarget,
  fichier: File,
  onPart: (p: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(cible.method, cible.url.startsWith('/') ? apiUrl(cible.url) : cible.url);
    // Le stockage local reconnaît la RH à sa session ; Cloudflare, à l'adresse.
    xhr.withCredentials = cible.mode === 'local';
    xhr.setRequestHeader('Content-Type', fichier.type || 'video/mp4');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onPart(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status < 300) return resolve();
      let titre = `Erreur ${xhr.status}`;
      try {
        titre = (JSON.parse(xhr.responseText) as { title?: string }).title ?? titre;
      } catch {
        /* réponse sans corps */
      }
      reject(new Error(titre));
    };
    xhr.onerror = () => reject(new Error('La connexion a été coupée pendant l’envoi.'));
    xhr.send(fichier);
  });
}

export default function AtelierFormationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const vue = useQuery({
    queryKey: ['academy', 'gestion', id],
    queryFn: () => api<CourseAdminView>(`/academy/gestion/courses/${id}`),
  });
  const [edition, setEdition] = useState(false);
  const [suppression, setSuppression] = useState<
    | { type: 'formation' }
    | { type: 'module'; module: ModuleView }
    | { type: 'lecon'; lecon: LessonView }
    | null
  >(null);
  const [envois, setEnvois] = useState<Record<string, Envoi>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  const rafraichir = () => qc.invalidateQueries({ queryKey: ['academy'] });

  // Quitter la page pendant un envoi le couperait : on prévient.
  const enCours = Object.values(envois).some((e) => e.part !== undefined);
  useEffect(() => {
    if (!enCours) return;
    const retenir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [enCours]);

  const action = useMutation({
    mutationFn: ({
      chemin,
      methode,
      corps,
    }: {
      chemin: string;
      methode: string;
      corps?: unknown;
    }) => api(chemin, { method: methode, body: corps }),
    onSuccess: () => rafraichir(),
    onError: (err) => setErreur(err instanceof ApiError ? err.message : 'Action impossible.'),
  });
  const agir = (chemin: string, methode: string, corps?: unknown) => {
    setErreur(null);
    action.mutate({ chemin, methode, corps });
  };

  async function deposerVideo(lecon: LessonView, fichier: File) {
    const poser = (e: Envoi | null) =>
      setEnvois((tous) => {
        const suite = { ...tous };
        if (e) suite[lecon.id] = e;
        else delete suite[lecon.id];
        return suite;
      });
    if (fichier.size > MAX_VIDEO_LOCALE_BYTES) {
      poser({ erreur: 'Le fichier dépasse 2 Go : exportez la vidéo en 1080p ou 720p.' });
      return;
    }
    const duree = await lireDuree(fichier);
    if (duree !== null && duree > DUREE_MAX_LECON_S + MARGE_DUREE_S) {
      poser({
        erreur: `La vidéo dure ${minutesSecondes(duree)} : une leçon fait 12 minutes au plus. Découpez-la en plusieurs leçons.`,
      });
      return;
    }
    poser({ part: 0 });
    try {
      const cible = await api<VideoUploadTarget>(`/academy/lessons/${lecon.id}/video`, {
        method: 'POST',
        body: {
          filename: fichier.name,
          size: fichier.size,
          contentType: fichier.type || undefined,
        },
      });
      await rafraichir();
      await envoyerFichier(cible, fichier, (p) => poser({ part: p }));
      poser(null);
    } catch (err) {
      poser({ erreur: err instanceof Error ? err.message : 'Envoi impossible.' });
    } finally {
      await rafraichir();
    }
  }

  async function deposerSupport(lecon: LessonView, fichier: File) {
    setErreur(null);
    if (fichier.size > MAX_SUPPORT_BYTES) {
      setErreur('Le support doit faire 10 Mo maximum.');
      return;
    }
    try {
      await api(
        `/academy/lessons/${lecon.id}/support?filename=${encodeURIComponent(fichier.name)}`,
        { method: 'POST', body: new Blob([fichier], { type: 'application/pdf' }) },
      );
      await rafraichir();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : 'Dépôt du support impossible.');
    }
  }

  if (vue.isPending) {
    return (
      <Page>
        <Skeleton className="h-5 w-40 rounded-full" />
        <Skeleton className="h-[150px] w-full rounded-[16px]" />
        <Skeleton className="h-[280px] w-full rounded-[16px]" />
      </Page>
    );
  }
  if (vue.isError) {
    return (
      <Page>
        <RetourAcademy href="/academy/gerer" label="Gérer le catalogue" />
        <LoadFailure error={vue.error} onRetry={() => void vue.refetch()} />
      </Page>
    );
  }

  const f = vue.data;
  const famille = FAMILLES[f.category];
  const publiable = f.obstacles.length === 0;

  return (
    <Page>
      <RetourAcademy href="/academy/gerer" label="Gérer le catalogue" />

      {/* ———— La formation, et son état ———— */}
      <Card className="shrink-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row">
          <Couverture category={f.category} className="h-24 shrink-0 sm:h-auto sm:w-44" />
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
                {famille.label}
              </span>
              {f.published ? (
                <Badge tone="success">Publiée</Badge>
              ) : publiable ? (
                <Badge tone="neutral">Prête à publier</Badge>
              ) : (
                <Badge tone="warning">À compléter</Badge>
              )}
            </div>
            <h1 className="text-[20px] leading-tight font-bold tracking-[-0.02em] text-ink-strong">
              {f.title}
            </h1>
            {f.summary ? (
              <p className="line-clamp-3 max-w-[75ch] text-[12.5px] leading-relaxed text-ink-muted">
                {f.summary}
              </p>
            ) : null}
            <p className="text-[12px] font-semibold text-ink-muted">
              {compte(f.moduleCount, 'module')} · {compte(f.lessonCount, 'leçon')}
              {f.totalSeconds > 0 ? ` · ${dureeLisible(f.totalSeconds)} de vidéo` : ''}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {f.published ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    agir(`/academy/courses/${f.id}/publication`, 'POST', { published: false })
                  }
                >
                  Retirer du catalogue
                </Button>
              ) : (
                <Button
                  disabled={!publiable}
                  title={publiable ? undefined : 'Réglez d’abord les points ci-dessous'}
                  onClick={() =>
                    agir(`/academy/courses/${f.id}/publication`, 'POST', { published: true })
                  }
                >
                  <Icon name="check" size={16} />
                  Publier
                </Button>
              )}
              <Button variant="secondary" onClick={() => setEdition(true)}>
                <Icon name="edit" size={15} />
                Modifier
              </Button>
              <Link href={`/academy/${f.id}`}>
                <Button variant="ghost">
                  <Icon name="visibility" size={16} />
                  Aperçu
                </Button>
              </Link>
              {!f.published ? (
                <Button
                  variant="ghost"
                  className="ml-auto hover:bg-danger-soft hover:text-danger"
                  onClick={() => setSuppression({ type: 'formation' })}
                >
                  <Icon name="delete" size={16} />
                  Supprimer
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {erreur ? (
        <p
          role="alert"
          className="rounded-[12px] bg-danger-soft px-4 py-2.5 text-[12.5px] font-semibold text-danger"
        >
          {erreur}
        </p>
      ) : null}

      {/* ———— Ce qui attend la RH avant publication ———— */}
      {!f.published && f.obstacles.length > 0 ? (
        <div className="flex gap-3 rounded-[14px] border border-accent/25 bg-accent-soft/50 px-4 py-3">
          <Icon name="error" size={17} className="mt-px shrink-0 text-accent-text" />
          <div className="min-w-0 text-[12.5px] leading-relaxed text-ink">
            <b className="font-bold text-accent-text">Avant de publier</b>
            <ul className="mt-0.5 list-disc pl-4">
              {f.obstacles.map((o) => (
                <li key={`${o.lessonId}-${o.texte}`}>{o.texte}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* ———— Les modules ———— */}
      {f.modules.map((m, i) => (
        <CarteModule
          key={m.id}
          module={m}
          rang={i}
          dernier={i === f.modules.length - 1}
          publiee={f.published}
          envois={envois}
          agir={agir}
          onSupprimerModule={() => setSuppression({ type: 'module', module: m })}
          onSupprimerLecon={(l) => setSuppression({ type: 'lecon', lecon: l })}
          onVideo={deposerVideo}
          onSupport={deposerSupport}
        />
      ))}

      <AjoutRapide
        placeholder={f.modules.length === 0 ? 'Titre du premier module' : 'Titre du module suivant'}
        bouton="Ajouter un module"
        onAjout={(title) => agir(`/academy/courses/${f.id}/modules`, 'POST', { title })}
        className="pb-2"
      />

      <SectionEvaluation formation={f} />

      {edition ? <FormationModal open formation={f} onClose={() => setEdition(false)} /> : null}

      {suppression?.type === 'formation' ? (
        <FenetreSuppression
          titre="Supprimer la formation"
          nom={f.title}
          bouton="Supprimer la formation"
          chemin={`/academy/courses/${f.id}`}
          onClose={() => setSuppression(null)}
          onSupprime={() => {
            // Oublier la formation AVANT de partir : la relire maintenant
            // rendrait un 404 pour une suppression réussie.
            qc.removeQueries({ queryKey: ['academy', 'gestion', f.id] });
            router.push('/academy/gerer');
            void qc.invalidateQueries({ queryKey: ['academy', 'gestion'], exact: true });
            void qc.invalidateQueries({ queryKey: ['academy', 'catalogue'] });
          }}
        >
          <p className="text-[12.5px] leading-relaxed text-ink">
            Ses {compte(f.moduleCount, 'module')}, ses {compte(f.lessonCount, 'leçon')} et leurs
            vidéos seront effacés. Cette formation n’a jamais été publiée : aucun agent ne la suit.
          </p>
        </FenetreSuppression>
      ) : null}
      {suppression?.type === 'module' ? (
        <FenetreSuppression
          titre="Supprimer le module"
          nom={suppression.module.title}
          bouton="Supprimer le module"
          chemin={`/academy/modules/${suppression.module.id}`}
          onClose={() => setSuppression(null)}
          onSupprime={() => {
            setSuppression(null);
            void rafraichir();
          }}
        >
          <p className="text-[12.5px] leading-relaxed text-ink">
            Ses {compte(suppression.module.lessons.length, 'leçon')} et leurs vidéos seront
            effacées.
          </p>
        </FenetreSuppression>
      ) : null}
      {suppression?.type === 'lecon' ? (
        <FenetreSuppression
          titre="Supprimer la leçon"
          nom={suppression.lecon.title}
          bouton="Supprimer la leçon"
          chemin={`/academy/lessons/${suppression.lecon.id}`}
          onClose={() => setSuppression(null)}
          onSupprime={() => {
            setSuppression(null);
            void rafraichir();
          }}
        >
          <p className="text-[12.5px] leading-relaxed text-ink">
            Sa vidéo et son support seront effacés.
          </p>
        </FenetreSuppression>
      ) : null}
    </Page>
  );
}

/** Un champ et un bouton : ajouter sans ouvrir de fenêtre. */
function AjoutRapide({
  placeholder,
  bouton,
  onAjout,
  className,
}: {
  placeholder: string;
  bouton: string;
  onAjout: (titre: string) => void;
  className?: string;
}) {
  const [titre, setTitre] = useState('');
  const valider = () => {
    if (!titre.trim()) return;
    onAjout(titre.trim());
    setTitre('');
  };
  return (
    <form
      className={cn('flex flex-col gap-2 sm:flex-row', className)}
      onSubmit={(e) => {
        e.preventDefault();
        valider();
      }}
    >
      <Input
        value={titre}
        maxLength={160}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setTitre(e.target.value)}
        className="h-9 w-full max-w-md shrink-0 rounded-full sm:shrink sm:flex-1"
      />
      <Button type="submit" variant="secondary" disabled={!titre.trim()} className="self-start">
        <Icon name="add" size={16} />
        {bouton}
      </Button>
    </form>
  );
}

/** Un titre qui se modifie sur place : clic, frappe, Entrée. */
function TitreModifiable({
  titre,
  onRenommer,
  className,
}: {
  titre: string;
  onRenommer: (t: string) => void;
  className?: string;
}) {
  const [edite, setEdite] = useState(false);
  const [valeur, setValeur] = useState(titre);
  useEffect(() => setValeur(titre), [titre]);
  if (edite) {
    return (
      <form
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (valeur.trim() && valeur.trim() !== titre) onRenommer(valeur.trim());
          setEdite(false);
        }}
      >
        <Input
          autoFocus
          value={valeur}
          maxLength={160}
          aria-label="Nouveau titre"
          onChange={(e) => setValeur(e.target.value)}
          onBlur={() => {
            if (valeur.trim() && valeur.trim() !== titre) onRenommer(valeur.trim());
            setEdite(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValeur(titre);
              setEdite(false);
            }
          }}
          className="h-8 w-full"
        />
      </form>
    );
  }
  return (
    <button
      type="button"
      title="Renommer"
      onClick={() => setEdite(true)}
      className={cn(
        'group/titre flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
        className,
      )}
    >
      {/* Sur téléphone, le titre passe à la ligne plutôt que d'être rogné :
          la RH doit relire ce qu'elle a tapé. */}
      <span className="min-w-0 break-words md:truncate">{titre}</span>
      <Icon
        name="edit"
        size={13}
        className="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover/titre:opacity-100"
      />
    </button>
  );
}

function BoutonIcone({
  icone,
  label,
  onClick,
  disabled,
  danger,
}: {
  icone: 'arrow_upward' | 'arrow_downward' | 'delete';
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-150 disabled:pointer-events-none disabled:opacity-30',
        danger
          ? 'hover:bg-danger-soft hover:text-danger'
          : 'hover:bg-primary-soft hover:text-primary',
      )}
    >
      <Icon name={icone} size={16} />
    </button>
  );
}

function CarteModule({
  module: m,
  rang,
  dernier,
  publiee,
  envois,
  agir,
  onSupprimerModule,
  onSupprimerLecon,
  onVideo,
  onSupport,
}: {
  module: ModuleView;
  rang: number;
  dernier: boolean;
  publiee: boolean;
  envois: Record<string, Envoi>;
  agir: (chemin: string, methode: string, corps?: unknown) => void;
  onSupprimerModule: () => void;
  onSupprimerLecon: (l: LessonView) => void;
  onVideo: (l: LessonView, f: File) => void;
  onSupport: (l: LessonView, f: File) => void;
}) {
  return (
    <Card className="shrink-0">
      <div className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5">
        <span className="shrink-0 text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
          Module {rang + 1}
        </span>
        <TitreModifiable
          titre={m.title}
          onRenommer={(title) => agir(`/academy/modules/${m.id}`, 'PATCH', { title })}
          className="text-[13.5px] font-bold text-ink-strong"
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <BoutonIcone
            icone="arrow_upward"
            label="Monter le module"
            disabled={rang === 0}
            onClick={() => agir(`/academy/modules/${m.id}/deplacer`, 'POST', { sens: 'haut' })}
          />
          <BoutonIcone
            icone="arrow_downward"
            label="Descendre le module"
            disabled={dernier}
            onClick={() => agir(`/academy/modules/${m.id}/deplacer`, 'POST', { sens: 'bas' })}
          />
          {!publiee ? (
            <BoutonIcone
              icone="delete"
              label="Supprimer le module"
              danger
              onClick={onSupprimerModule}
            />
          ) : null}
        </div>
      </div>

      <ol className="flex flex-col">
        {m.lessons.map((l, i) => (
          <LigneLecon
            key={l.id}
            lecon={l}
            numero={i + 1}
            premiere={i === 0}
            derniere={i === m.lessons.length - 1}
            publiee={publiee}
            envoi={envois[l.id]}
            agir={agir}
            onSupprimer={() => onSupprimerLecon(l)}
            onVideo={(f) => onVideo(l, f)}
            onSupport={(f) => onSupport(l, f)}
          />
        ))}
      </ol>

      <AjoutRapide
        placeholder={
          m.lessons.length === 0 ? 'Titre de la première leçon' : 'Titre de la leçon suivante'
        }
        bouton="Ajouter une leçon"
        onAjout={(title) => agir(`/academy/modules/${m.id}/lessons`, 'POST', { title })}
        className="px-5 py-3.5"
      />
    </Card>
  );
}

function LigneLecon({
  lecon: l,
  numero,
  premiere,
  derniere,
  publiee,
  envoi,
  agir,
  onSupprimer,
  onVideo,
  onSupport,
}: {
  lecon: LessonView;
  numero: number;
  premiere: boolean;
  derniere: boolean;
  publiee: boolean;
  envoi: Envoi | undefined;
  agir: (chemin: string, methode: string, corps?: unknown) => void;
  onSupprimer: () => void;
  onVideo: (f: File) => void;
  onSupport: (f: File) => void;
}) {
  const choixVideo = useRef<HTMLInputElement>(null);
  const choixSupport = useRef<HTMLInputElement>(null);
  const [apercu, setApercu] = useState(false);
  const envoie = envoi?.part !== undefined;

  let etatVideo: React.ReactNode;
  if (envoie) {
    etatVideo = (
      // Le BLEU : l'envoi avance tout seul, il n'attend rien de la RH. L'orange
      // est pour ce qui attend son geste — une vidéo manquante, un envoi coupé.
      <span className="flex min-w-40 items-center gap-2 text-[11.5px] font-semibold text-primary">
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-chart-track">
          <span
            className="block h-full rounded-full bg-primary transition-[width] duration-300"
            style={{ width: `${Math.round((envoi.part ?? 0) * 100)}%` }}
          />
        </span>
        Envoi… {Math.round((envoi.part ?? 0) * 100)} %
      </span>
    );
  } else if (l.videoStatus === 'prete' && l.durationSeconds) {
    // Une vidéo prête le reste, même si un REMPLACEMENT vient d'être refusé :
    // l'ancienne n'a pas bougé, et la ligne d'explication dit le refus.
    etatVideo = (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-success">
        <Icon name="check_circle" size={15} fill />
        Vidéo prête · {horloge(l.durationSeconds)}
      </span>
    );
  } else if (envoi?.erreur || l.videoStatus === 'erreur') {
    etatVideo = (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-danger">
        <Icon name="error" size={15} />À redéposer
      </span>
    );
  } else if (l.videoStatus === 'envoi' || l.videoStatus === 'traitement') {
    etatVideo = (
      <span className="text-[11.5px] font-semibold text-accent-text">
        {l.videoStatus === 'traitement'
          ? 'Vidéo en traitement…'
          : 'Envoi interrompu — redéposez la vidéo'}
      </span>
    );
  } else {
    etatVideo = (
      <span className="text-[11.5px] font-semibold text-accent-text">Pas encore de vidéo</span>
    );
  }
  // L'explication d'un refus tient sa PROPRE ligne : dans la rangée, elle
  // écrasait le titre de la leçon jusqu'à le rendre illisible.
  const explication =
    envoi?.erreur ??
    (l.videoStatus === 'erreur' ? (l.videoError ?? 'La vidéo est en erreur.') : null);

  return (
    <li className="border-b border-line-soft px-5 py-3 last:border-b-0">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="w-5 shrink-0 text-right text-[12px] font-semibold text-ink-muted"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {numero}.
          </span>
          <TitreModifiable
            titre={l.title}
            onRenommer={(title) => agir(`/academy/lessons/${l.id}`, 'PATCH', { title })}
            className="text-[12.5px] font-semibold text-ink"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pl-8 md:pl-0">
          {etatVideo}
          <input
            ref={choixVideo}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.m4v,.mov"
            className="hidden"
            onChange={(e) => {
              const fichier = e.target.files?.[0];
              e.target.value = '';
              if (fichier) onVideo(fichier);
            }}
          />
          <Button
            size="sm"
            variant={l.videoStatus === 'prete' ? 'ghost' : 'secondary'}
            disabled={envoie}
            onClick={() => choixVideo.current?.click()}
          >
            <Icon name="upload_file" size={15} />
            {l.videoStatus === 'prete' ? 'Remplacer' : 'Déposer la vidéo'}
          </Button>

          <input
            ref={choixSupport}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const fichier = e.target.files?.[0];
              e.target.value = '';
              if (fichier) onSupport(fichier);
            }}
          />
          {l.support ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-line-soft py-0.5 pr-1 pl-2.5 text-[11.5px] font-semibold text-ink">
              <button
                type="button"
                title="Voir le support"
                onClick={() => setApercu(true)}
                className="inline-flex max-w-40 items-center gap-1 rounded-full hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
              >
                <Icon name="description" size={14} className="shrink-0 text-primary" />
                <span className="truncate">{l.support.filename}</span>
              </button>
              <button
                type="button"
                aria-label="Retirer le support"
                title="Retirer le support"
                onClick={() => agir(`/academy/lessons/${l.id}/support`, 'DELETE')}
                className="grid size-5 place-items-center rounded-full text-ink-muted hover:bg-danger-soft hover:text-danger"
              >
                <Icon name="close" size={13} />
              </button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => choixSupport.current?.click()}>
              <Icon name="description" size={15} />
              Support PDF
            </Button>
          )}

          <div className="flex items-center gap-0.5">
            <BoutonIcone
              icone="arrow_upward"
              label="Monter la leçon"
              disabled={premiere}
              onClick={() => agir(`/academy/lessons/${l.id}/deplacer`, 'POST', { sens: 'haut' })}
            />
            <BoutonIcone
              icone="arrow_downward"
              label="Descendre la leçon"
              disabled={derniere}
              onClick={() => agir(`/academy/lessons/${l.id}/deplacer`, 'POST', { sens: 'bas' })}
            />
            {!publiee ? (
              <BoutonIcone icone="delete" label="Supprimer la leçon" danger onClick={onSupprimer} />
            ) : null}
          </div>
        </div>
      </div>
      {explication ? (
        <p
          role="alert"
          className="mt-1.5 pl-8 text-[11.5px] leading-snug font-semibold text-danger"
        >
          {explication}
        </p>
      ) : null}
      {apercu && l.support ? (
        <FenetreDocument
          doc={{
            url: apiUrl(`/academy/lessons/${l.id}/support?disposition=inline`),
            filename: l.support.filename,
            contentType: 'application/pdf',
            titre: `Support — ${l.title}`,
          }}
          telechargement={apiUrl(`/academy/lessons/${l.id}/support`)}
          onClose={() => setApercu(false)}
        />
      ) : null}
    </li>
  );
}
