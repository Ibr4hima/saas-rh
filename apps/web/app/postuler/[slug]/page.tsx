'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { PublicJobInfo } from '@teranga/contracts';
import {
  ALLOWED_DOCUMENT_TYPES,
  deElide,
  LANGUE_LABELS,
  libellePostes,
  MAX_DOCUMENT_BYTES,
  NIVEAU_ETUDES_LABELS,
  premierPrenom,
} from '@teranga/contracts';
import { Button, Field, Input, Skeleton, cn } from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { BarreDefilement } from '../../../components/barre-defilement';
import { BrandMark } from '../../../components/brand-mark';
import { Icon, type IconName } from '../../../components/icons';
import { PhoneInput } from '../../../components/phone-input';
import { composePhone, DEFAULT_COUNTRY } from '../../../lib/countries';
import { experienceExigee, libelleContrat } from '../../../lib/recruitment';
import {
  DescriptionOffre,
  FaitOffre,
  joursRestants,
  jourFr,
} from '../../../components/offre-fiche';
import { useThemeClair } from '../../../components/preferences';
import { anciennete, useHorlogeMinute } from '../../../lib/temps';

const INVALID_MESSAGES: Record<string, string> = {
  closed: "La date limite de candidature est passée : cette offre n'accepte plus de dossiers.",
  not_found: "Cette offre n'existe pas ou n'est plus publiée.",
};

const FORMATS = 'PDF uniquement';
const POIDS_MAX = '5 Mo maximum';

interface PickedFile {
  filename: string;
  contentType: string;
  contentBase64: string;
  sizeBytes: number;
}

/** Le nom sans son « .pdf » : c'est la partie qu'on renomme. */
const sansExtension = (nom: string) => nom.replace(/\.pdf$/i, '');

/**
 * Une pièce à joindre, choisie ou non.
 *
 * Le `<input type=file>` du navigateur affiche « Aucun fichier choisi » dans
 * une langue qui n'est pas forcément celle de la page, et ne dit ni le format
 * attendu ni le poids permis tant qu'on n'a pas échoué. On garde l'input —
 * c'est lui qui ouvre le sélecteur et que lisent les lecteurs d'écran — mais
 * on l'habille : avant, une zone qui annonce ce qu'on attend ; après, le
 * fichier retenu, son poids, et de quoi le remplacer.
 */
function PieceJointe({
  label,
  fichier,
  onPick,
  onRenommer,
  onClear,
}: {
  label: string;
  fichier?: PickedFile;
  onPick: (f: File | null) => void;
  onRenommer: (nom: string) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = `doc-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const champ = (classe: string) => (
    <input
      ref={input}
      id={id}
      type="file"
      className={classe}
      accept={Object.values(ALLOWED_DOCUMENT_TYPES).join(',')}
      onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        // On vide l'input : re-choisir le MÊME nom de fichier (après l'avoir
        // compressé, par exemple) doit redéclencher l'événement.
        e.target.value = '';
        onPick(f);
      }}
    />
  );

  if (fichier) {
    return (
      <div className="flex items-center gap-3 rounded-[11px] border border-success/35 bg-success-soft px-3.5 py-3">
        {champ('sr-only')}
        <Icon name="check_circle" size={20} className="shrink-0 text-success" />
        {/* Le nom du fichier est le titre de la pièce, et se corrige ici même,
            comme au dépôt d'un document dans l'espace personnel : « Document
            (3) copie » est le classement du candidat sur son propre disque,
            et c'est ce qui arrive dans la file du recruteur. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 border-b border-ink/15 pb-0.5 transition-colors focus-within:border-primary">
            <input
              value={sansExtension(fichier.filename)}
              onChange={(e) => onRenommer(e.target.value)}
              aria-label={`Renommer ${label}`}
              placeholder={label}
              maxLength={120}
              spellCheck={false}
              className="min-w-0 flex-1 truncate bg-transparent text-[13px] font-bold text-ink-strong outline-none placeholder:text-ink-muted/60"
            />
            <Icon name="edit" size={14} aria-hidden className="shrink-0 text-ink-muted/70" />
          </div>
          <p className="mt-1 truncate text-[11.5px] text-ink-muted">
            {label} · PDF · {Math.max(1, Math.round(fichier.sizeBytes / 1024))} Ko
          </p>
        </div>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="shrink-0 rounded-[7px] px-2 py-1 text-[12px] font-semibold text-primary transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          Remplacer
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label={`Retirer ${label}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-danger-soft hover:text-danger focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    );
  }

  return (
    <label
      htmlFor={id}
      className="relative flex cursor-pointer items-center gap-3 rounded-[11px] border border-dashed border-line bg-surface-raised px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-primary/40 hover:border-primary/50 hover:bg-primary-soft/40"
    >
      {/* Le champ COUVRE la zone au lieu de se cacher dans un coin. Un
          `sr-only` est une boîte d'un pixel posée ailleurs que là où l'on
          clique : en ouvrant le sélecteur, le navigateur l'amène dans la vue
          et fait sauter le conteneur qui défile. Ici l'élément focalisé est
          exactement sous le curseur, il n'y a rien à ramener. */}
      {champ('absolute inset-0 cursor-pointer opacity-0')}
      <Icon name="upload_file" size={20} className="shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-ink-strong">{label}</p>
        <p className="text-[11.5px] text-ink-muted">
          {FORMATS} · {POIDS_MAX}
        </p>
      </div>
      <span className="shrink-0 text-[12px] font-semibold text-primary">Choisir…</span>
    </label>
  );
}

/** La carte des écrans de message : blanche, à peine ombrée, posée sur le fond. */
const CARTE =
  'rounded-[24px] bg-surface ring-1 ring-line-soft shadow-[0_1px_2px_rgb(20_23_42/0.04),0_12px_32px_-16px_rgb(20_23_42/0.14)]';

/** L'intitulé d'une rubrique, en capitales espacées. */
function Rubrique({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex items-center justify-between gap-3">
      <p className="text-[10.5px] font-extrabold tracking-[0.16em] text-primary uppercase">
        {children}
      </p>
      {extra}
    </div>
  );
}

/** Un fait de l'offre, en pastille sous le titre. */
function Etiquette({ icon, children }: { icon: IconName; children: React.ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[12.5px] font-semibold text-ink ring-1 ring-line-soft">
      <Icon name={icon} size={15} className="shrink-0 text-primary/75" />
      {children}
    </li>
  );
}

/** Les écrans sans offre (chargement raté, offre close) : le logo, une carte au centre. */
function Coquille({ children }: { children: React.ReactNode }) {
  return (
    <main className="fond-offre min-h-dvh">
      <header className="mx-auto flex h-20 max-w-6xl items-center px-5 sm:px-8">
        <BrandMark variant="entete" repli="A" />
      </header>
      {children}
    </main>
  );
}

/**
 * La page d'une offre, en deux volets de pleine hauteur : l'offre sur le fond
 * teinté, le formulaire sur le blanc.
 *
 * Sur grand écran, comme deux pages d'un livre ouvert : le formulaire reste
 * immobile, et c'est l'offre seule qui défile, sa longueur dépendant de ce
 * que le recruteur a rédigé. Sa barre de défilement se pose sur la couture
 * entre les deux volets. La molette tournée au-dessus du formulaire fait
 * défiler l'offre elle aussi : le formulaire n'a rien à faire défiler.
 *
 * Les deux volets partent du même point haut, et le logo comme « Postuler »
 * y occupent une ligne de 48 px : leurs centres restent alignés quelle que
 * soit la hauteur de l'écran. Ce départ centre à peu près le formulaire
 * (40rem), sans descendre sous 3rem. Sur un écran trop bas pour le montrer
 * en entier, le formulaire défile à son tour : son bouton d'envoi doit
 * rester atteignable.
 *
 * Sur téléphone, les volets s'empilent et la page défile d'un seul tenant.
 */
const DEPART = 'lg:pt-[max(3rem,calc(50dvh_-_20rem))]';

function Volets({
  initiale,
  offre,
  formulaire,
}: {
  initiale?: string;
  offre: React.ReactNode;
  formulaire: React.ReactNode;
}) {
  const gauche = useRef<HTMLDivElement>(null);

  /** La molette au-dessus du formulaire, quand il tient dans l'écran, fait défiler l'offre. */
  const versLOffre = (e: React.WheelEvent<HTMLDivElement>) => {
    const droite = e.currentTarget;
    if (droite.scrollHeight > droite.clientHeight + 1) return;
    // Firefox compte parfois en lignes : une ligne vaut environ 16 px.
    gauche.current?.scrollBy({ top: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY });
  };

  return (
    <main className="min-h-dvh bg-surface lg:relative lg:grid lg:h-dvh lg:grid-cols-2 lg:overflow-hidden">
      <div
        ref={gauche}
        className="fond-offre sans-barre lg:h-dvh lg:overflow-y-auto lg:overscroll-contain"
      >
        <div
          className={cn(
            'mx-auto flex max-w-[640px] flex-col px-5 pt-6 pb-10 sm:px-10 lg:mr-0 lg:px-12 lg:pb-16 xl:px-16',
            DEPART,
          )}
        >
          <BrandMark variant="entete" repli={initiale ?? 'A'} />
          {offre}
        </div>
      </div>
      <div
        onWheel={versLOffre}
        className="border-t border-line-soft lg:h-dvh lg:overflow-y-auto lg:border-t-0 lg:border-l"
      >
        <div
          className={cn(
            'mx-auto max-w-[560px] px-5 pt-10 pb-14 sm:px-10 lg:ml-0 lg:px-12 lg:pb-12 xl:px-16',
            DEPART,
          )}
        >
          {formulaire}
        </div>
      </div>
      {/* Sur la couture : le filet du volet droit passe à 50 % + 0,5 px. */}
      <BarreDefilement
        cible={gauche}
        className="absolute inset-y-4 left-[calc(50%+0.5px)] hidden w-4 -translate-x-1/2 lg:block"
      />
    </main>
  );
}

/** Les écrans qui n'ont qu'un message à donner : erreur, offre close. */
function Ecran({
  icon,
  titre,
  children,
  action,
}: {
  icon: IconName;
  titre: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex justify-center px-5 pt-[12vh] pb-16">
      <div
        className={cn(CARTE, 'flex w-full max-w-md flex-col items-center px-8 py-10 text-center')}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-[#eef2f7] text-ink-muted">
          <Icon name={icon} size={24} />
        </span>
        <h1 className="mt-4 text-[18px] font-extrabold text-ink-strong">{titre}</h1>
        {children ? (
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{children}</p>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  );
}

export default function ApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  // Une page publique : une seule teinte, la claire. Le candidat n'a pas de
  // compte, donc pas de préférence, et la page de l'employeur ne s'inverse pas.
  useThemeClair();
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [phonePays, setPhonePays] = useState(DEFAULT_COUNTRY);
  const [phoneLocal, setPhoneLocal] = useState('');
  const [files, setFiles] = useState<Record<string, PickedFile>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Le refus du serveur s'affiche au pied d'un formulaire qu'on a pu faire
  // défiler : on l'amène sous les yeux, sinon on recliquerait sans savoir.
  const alerte = useRef<HTMLParagraphElement>(null);

  const info = useQuery({
    queryKey: ['public-job', slug],
    queryFn: () => api<PublicJobInfo>(`/public/jobs/${slug}`),
    retry: false,
  });

  const offre = info.data?.valid ? info.data : null;
  // Le candidat lit la page sans se presser : l'âge de l'offre ne doit pas
  // rester figé sur la minute où elle s'est ouverte.
  useHorlogeMinute();

  useEffect(() => {
    if (offre) document.title = `${offre.title} · ${offre.organizationName}`;
  }, [offre]);

  useEffect(() => {
    if (serverError) alerte.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [serverError]);

  const apply = useMutation({
    mutationFn: () =>
      api(`/public/jobs/${slug}/apply`, {
        method: 'POST',
        body: {
          givenName,
          familyName,
          email,
          phone: composePhone(phonePays, phoneLocal),
          documents: Object.entries(files).map(([label, f]) => ({
            label,
            filename: sansExtension(f.filename).trim() ? f.filename : `${label}.pdf`,
            contentType: f.contentType,
            contentBase64: f.contentBase64,
          })),
        },
      }),
    onSuccess: () => setSent(true),
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Envoi impossible, réessayez.'),
  });

  /**
   * Renommer une pièce déjà choisie.
   *
   * Le nom est celui qui arrivera dans la file du recruteur : il vaut mieux
   * « CV Mouhamadou Kane » que « Document (3) copie.pdf ». L'extension n'est
   * pas modifiable : elle dit le format, qui n'est pas au choix du candidat.
   * Un nom vidé part sous celui de la pièce (« CV.pdf »).
   */
  const renommer = (label: string, nom: string) => {
    const propre = nom.replace(/[\\/:*?"<>|]/g, '').slice(0, 120);
    setFiles((prev) => {
      const piece = prev[label];
      if (!piece) return prev;
      return { ...prev, [label]: { ...piece, filename: `${propre}.pdf` } };
    });
  };

  const pickFile = (label: string, file: File | null) => {
    setFileError(null);
    // Toute nouvelle sélection remplace l'ancienne : invalide = case vidée.
    setFiles((prev) => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
    if (!file) return;
    if (!(file.type in ALLOWED_DOCUMENT_TYPES)) {
      setFileError(`« ${file.name} » : seuls les PDF sont acceptés.`);
      return;
    }
    if (file.size === 0) {
      setFileError(`« ${file.name} » est vide. Vérifiez le fichier (synchronisation cloud ?).`);
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setFileError(`« ${file.name} » dépasse 5 Mo.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(',')[1] ?? '';
      setFiles((prev) => ({
        ...prev,
        [label]: {
          filename: file.name,
          contentType: file.type,
          contentBase64: base64,
          sizeBytes: file.size,
        },
      }));
    };
    reader.onerror = () =>
      setFileError(
        `Impossible de lire « ${file.name} ». Réessayez ou choisissez un autre fichier.`,
      );
    reader.readAsDataURL(file);
  };

  if (info.isLoading) {
    return (
      <Volets
        offre={
          <div className="mt-9">
            <Skeleton className="h-4 w-28 rounded-full" />
            <Skeleton className="mt-4 h-11 w-full max-w-md rounded-xl" />
            <Skeleton className="mt-6 h-8 w-full max-w-sm rounded-full" />
            <Skeleton className="mt-12 h-40 w-full rounded-xl" />
          </div>
        }
        formulaire={<Skeleton className="h-[560px] w-full rounded-[20px]" />}
      />
    );
  }

  // Une erreur réseau/serveur n'est PAS « offre inexistante » : on distingue.
  if (info.isError) {
    return (
      <Coquille>
        <Ecran
          icon="error"
          titre="Chargement impossible"
          action={
            <Button variant="secondary" onClick={() => void info.refetch()}>
              Réessayer
            </Button>
          }
        >
          Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.
        </Ecran>
      </Coquille>
    );
  }

  if (!offre) {
    return (
      <Coquille>
        <Ecran icon="event_busy" titre="Offre indisponible">
          {INVALID_MESSAGES[info.data && !info.data.valid ? info.data.reason : 'not_found']}
        </Ecran>
      </Coquille>
    );
  }

  const manquants = offre.requiredDocuments.filter((label) => !files[label]);
  const emailValide = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const complet = Boolean(
    givenName.trim() && familyName.trim() && emailValide && manquants.length === 0,
  );
  const restants = offre.deadline ? joursRestants(offre.deadline) : null;
  // Un décompte n'informe que s'il est court : « 50 jours » à côté d'une date
  // ne dit rien de plus que la date, et occupe la place où l'urgence se lira.
  const compteRebours = restants !== null && restants <= 14;
  const urgence = restants !== null && restants <= 7;
  const age = anciennete(offre.createdAt);
  // Le profil recherché, ce que l'offre en dit : une offre antérieure peut ne
  // rien en porter, la rubrique disparaît alors plutôt que d'afficher du vide.
  const profil: { icon: IconName; label: string; valeur: string }[] = [
    offre.niveauEtudes
      ? {
          icon: 'school',
          label: 'Niveau d’études',
          valeur: NIVEAU_ETUDES_LABELS[offre.niveauEtudes],
        }
      : null,
    offre.experienceMin !== null
      ? { icon: 'trending_up', label: 'Expérience', valeur: experienceExigee(offre.experienceMin) }
      : null,
    offre.langues.length > 0
      ? {
          icon: 'translate',
          label: 'Langues',
          valeur: offre.langues.map((l) => LANGUE_LABELS[l]).join(', '),
        }
      : null,
  ].filter((f): f is { icon: IconName; label: string; valeur: string } => f !== null);

  const envoyer = () => {
    if (!complet || apply.isPending) return;
    setServerError(null);
    apply.mutate();
  };

  return (
    <Volets
      initiale={offre.organizationName[0]?.toUpperCase()}
      offre={
        <>
          <div className="mt-9">
            <p className="text-[11px] font-extrabold tracking-[0.18em] text-primary uppercase">
              Offre d’emploi
            </p>
            <h1 className="mt-3 text-[30px] leading-[1.1] font-extrabold tracking-[-0.022em] text-balance text-ink-strong sm:text-[38px]">
              {offre.title}
            </h1>
            <p className="mt-2.5 text-[12px] font-semibold text-ink-muted">
              <span className="tracking-[0.12em] uppercase">Réf</span> ·{' '}
              <span className="font-mono">{offre.reference}</span>
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              <Etiquette icon="business_center">
                {libelleContrat(offre.contractType, offre.dureeMois)}
              </Etiquette>
              {offre.nombrePostes > 1 ? (
                <Etiquette icon="groups">{libellePostes(offre.nombrePostes)}</Etiquette>
              ) : null}
              {offre.location ? <Etiquette icon="place">{offre.location}</Etiquette> : null}
              <Etiquette icon="event">
                {offre.deadline ? (
                  <>
                    Jusqu’au {jourFr(offre.deadline)}
                    {compteRebours ? (
                      <span className={urgence ? 'text-accent-text' : 'text-ink-muted'}>
                        {restants === 0
                          ? ' · dernier jour'
                          : ` · plus que ${restants} jour${restants! > 1 ? 's' : ''}`}
                      </span>
                    ) : null}
                  </>
                ) : (
                  'Sans date limite'
                )}
              </Etiquette>
              <Etiquette icon="schedule">
                {age === 'à l’instant' ? 'Publiée à l’instant' : `Publiée il y a ${age}`}
              </Etiquette>
            </ul>
            {/* Sur téléphone, le formulaire vient après l'offre : un geste
                pour y aller. */}
            {!sent ? (
              <a
                href="#postuler"
                className="mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-[14px] font-bold text-primary-ink shadow-sm transition-colors hover:bg-primary-hover lg:hidden"
              >
                Postuler
                <Icon name="arrow_downward" size={17} />
              </a>
            ) : null}
          </div>

          {profil.length > 0 ? (
            <div className="mt-10 border-t border-ink/[0.08] pt-8 lg:mt-12 lg:pt-10">
              <Rubrique>Profil recherché</Rubrique>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {profil.map((f) => (
                  <FaitOffre key={f.label} icon={f.icon} label={f.label}>
                    {f.valeur}
                  </FaitOffre>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-10 border-t border-ink/[0.08] pt-8 lg:mt-12 lg:pt-10">
            <Rubrique>Description du poste</Rubrique>
            <DescriptionOffre texte={offre.description} lecture />
          </div>
        </>
      }
      formulaire={
        <section id="postuler" className="scroll-mt-4">
          {sent ? (
            <div className="flex flex-col items-center pt-6 text-center lg:pt-16">
              <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
                <Icon name="check_circle" size={30} />
              </span>
              <h2 className="mt-5 text-[22px] font-extrabold tracking-[-0.015em] text-ink-strong">
                Candidature envoyée
              </h2>
              <p className="mt-2.5 max-w-sm text-[14px] leading-relaxed text-ink-muted">
                Merci {premierPrenom(givenName)} ! La Direction du Capital Humain a bien reçu votre
                candidature pour le poste {deElide(offre.title)}
                <span className="font-semibold text-ink">{offre.title}</span>. Votre dossier va être
                étudié avec attention. Bonne chance !
              </p>
              <p className="mt-6 text-[12px] text-ink-muted">
                Référence de l’offre :{' '}
                <span className="font-mono font-bold text-ink-strong">{offre.reference}</span>
              </p>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                envoyer();
              }}
              className="flex flex-col gap-8"
            >
              <h2 className="flex h-12 items-center text-[24px] font-extrabold tracking-[-0.015em] text-ink-strong">
                Postuler
              </h2>

              <fieldset className="min-w-0">
                <legend className="contents">
                  <Rubrique>Vos coordonnées</Rubrique>
                </legend>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 sm:grid-cols-2">
                  <Field label="Prénom" htmlFor="givenName" required>
                    <Input
                      id="givenName"
                      autoComplete="given-name"
                      value={givenName}
                      onChange={(e) => setGivenName(e.target.value)}
                    />
                  </Field>
                  <Field label="Nom" htmlFor="familyName" required>
                    <Input
                      id="familyName"
                      autoComplete="family-name"
                      value={familyName}
                      onChange={(e) => setFamilyName(e.target.value)}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Email" htmlFor="email" required>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Téléphone" htmlFor="phoneLocal">
                      <PhoneInput
                        id="phoneLocal"
                        country={phonePays}
                        local={phoneLocal}
                        onCountryChange={setPhonePays}
                        onLocalChange={setPhoneLocal}
                      />
                    </Field>
                  </div>
                </div>
              </fieldset>

              {offre.requiredDocuments.length > 0 ? (
                <fieldset className="min-w-0">
                  <legend className="contents">
                    <Rubrique
                      extra={
                        <span className="text-[11px] font-semibold text-ink-muted">
                          {offre.requiredDocuments.length - manquants.length} sur{' '}
                          {offre.requiredDocuments.length}
                        </span>
                      }
                    >
                      Vos pièces
                    </Rubrique>
                  </legend>
                  <div className="flex flex-col gap-2.5">
                    {offre.requiredDocuments.map((label) => (
                      <PieceJointe
                        key={label}
                        label={label}
                        fichier={files[label]}
                        onPick={(f) => pickFile(label, f)}
                        onRenommer={(nom) => renommer(label, nom)}
                        onClear={() =>
                          setFiles((prev) => {
                            const next = { ...prev };
                            delete next[label];
                            return next;
                          })
                        }
                      />
                    ))}
                  </div>
                  {fileError ? (
                    <p
                      role="alert"
                      className="mt-3 rounded-[10px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
                    >
                      {fileError}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}

              {serverError ? (
                <p
                  ref={alerte}
                  role="alert"
                  className="rounded-[12px] border border-danger/30 bg-danger-soft px-4 py-3 text-[12.5px] font-medium text-danger"
                >
                  {serverError}
                </p>
              ) : null}

              <div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={!complet}
                  loading={apply.isPending}
                >
                  Envoyer ma candidature
                </Button>
              </div>
            </form>
          )}
        </section>
      }
    />
  );
}
