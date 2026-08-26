'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicJobInfo } from '@teranga/contracts';
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from '@teranga/contracts';
import { Button, Card, CardContent, Field, Input, Skeleton, Textarea, cn } from '@teranga/ui';
import { api, ApiError } from '../../../lib/api';
import { Icon, type IconName } from '../../../components/icons';
import { Modal, ModalGrid, ModalSection } from '../../../components/modal';
import { CONTRACT_LABELS } from '../../../lib/recruitment';

const INVALID_MESSAGES: Record<string, string> = {
  closed: "La date limite de candidature est passée — cette offre n'accepte plus de dossiers.",
  not_found: "Cette offre n'existe pas ou n'est plus publiée.",
};

const FORMATS = 'PDF, Word, JPG ou PNG';
const POIDS_MAX = '5 Mo maximum';

interface PickedFile {
  filename: string;
  contentType: string;
  contentBase64: string;
  sizeBytes: number;
}

function jourFr(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Jours pleins d'ici la date limite — négatif une fois celle-ci passée. */
function joursRestants(iso: string): number {
  const jour = 86_400_000;
  const fin = new Date(`${iso}T00:00:00`).getTime();
  const auj = new Date(new Date().toDateString()).getTime();
  return Math.round((fin - auj) / jour);
}

/**
 * La description telle qu'on l'a tapée, rendue telle qu'on l'a pensée.
 *
 * La RH écrit ses missions en tirets, comme dans un traitement de texte. Sortie
 * en `whitespace-pre-wrap`, la liste garde ses tirets mais perd ses retraits :
 * une ligne qui passe à la suivante repart contre la marge et l'on ne sait plus
 * où finit un point ni où commence le suivant. On reconnaît donc les blocs de
 * puces et on les rend comme des puces — sans rien demander de plus à la RH.
 */
function Description({ texte }: { texte: string }) {
  const blocs = useMemo(
    () =>
      texte
        .split(/\n{2,}/)
        .map((bloc) => bloc.split('\n').filter((l) => l.trim().length > 0))
        .filter((lignes) => lignes.length > 0)
        .map((lignes) => {
          const puces = lignes.every((l) => /^\s*[-–—•*]\s+/.test(l));
          return puces
            ? { type: 'liste' as const, items: lignes.map((l) => l.replace(/^\s*[-–—•*]\s+/, '')) }
            : { type: 'texte' as const, texte: lignes.join('\n') };
        }),
    [texte],
  );

  return (
    <div className="flex flex-col gap-4">
      {blocs.map((bloc, i) =>
        bloc.type === 'liste' ? (
          <ul key={i} className="flex flex-col gap-2">
            {bloc.items.map((item, j) => (
              <li key={j} className="flex gap-2.5 text-[14.5px] leading-relaxed text-ink">
                <span
                  aria-hidden
                  className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary/45"
                />
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p key={i} className="text-[14.5px] leading-relaxed whitespace-pre-line text-ink">
            {bloc.texte}
          </p>
        ),
      )}
    </div>
  );
}

/** Un fait de l'offre : une icône, un intitulé, une valeur. */
function Fait({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon name={icon} size={18} className="mt-px shrink-0 text-primary/70" />
      <div className="min-w-0">
        <p className="text-[10px] font-extrabold tracking-[0.12em] text-ink-muted uppercase">
          {label}
        </p>
        <p className="mt-0.5 text-[13.5px] leading-snug font-semibold text-ink-strong">
          {children}
        </p>
      </div>
    </div>
  );
}

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
  onClear,
}: {
  label: string;
  fichier?: PickedFile;
  onPick: (f: File | null) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = `doc-${label.replace(/\s+/g, '-').toLowerCase()}`;

  const champ = (
    <input
      ref={input}
      id={id}
      type="file"
      className="sr-only"
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
        {champ}
        <Icon name="check_circle" size={20} className="shrink-0 text-success" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-ink-strong">{label}</p>
          <p className="truncate text-[11.5px] text-ink-muted">
            {fichier.filename} · {Math.max(1, Math.round(fichier.sizeBytes / 1024))} Ko
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
      className="flex cursor-pointer items-center gap-3 rounded-[11px] border border-dashed border-line bg-surface-raised px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-primary/40 hover:border-primary/50 hover:bg-primary-soft/40"
    >
      {champ}
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

/**
 * Bandeau de marque de la page publique.
 *
 * C'est la seule chose qui dit au candidat chez QUI il dépose son dossier —
 * jusqu'à l'écran de confirmation compris, où la question se repose : le nom
 * qui accuse réception doit être celui qu'on a vu en arrivant.
 */
function Bandeau({ organisation }: { organisation: string }) {
  return (
    <header className="hero-bar">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-white/15 text-[15px] font-extrabold text-hero-ink ring-1 ring-white/25">
            {organisation[0]}
          </span>
          <span className="truncate text-[14px] font-bold text-hero-ink">{organisation}</span>
        </div>
        <span className="hidden text-[11.5px] font-semibold text-hero-ink/75 sm:block">
          Espace recrutement
        </span>
      </div>
    </header>
  );
}

/** Coquille commune aux écrans qui n'ont qu'un message à donner. */
function Message({
  ton = 'neutre',
  icon,
  titre,
  children,
  action,
}: {
  ton?: 'neutre' | 'succes';
  icon: IconName;
  titre: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-5 py-12">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span
            className={cn(
              'flex size-12 items-center justify-center rounded-full',
              ton === 'succes' ? 'bg-success-soft text-success' : 'bg-bg text-ink-muted',
            )}
          >
            <Icon name={icon} size={26} />
          </span>
          <p className="text-[17px] font-bold text-ink-strong">{titre}</p>
          {children ? (
            <div className="text-[13.5px] leading-relaxed text-ink-muted">{children}</div>
          ) : null}
          {action}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ApplyPage() {
  const { slug } = useParams<{ slug: string }>();
  const [ouvert, setOuvert] = useState(false);
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<Record<string, PickedFile>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // La barre collante n'apparaît qu'une fois le bouton d'en-tête sorti de
  // l'écran : deux « Postuler » visibles en même temps, c'est un de trop.
  const ancre = useRef<HTMLDivElement>(null);
  const [ancreVisible, setAncreVisible] = useState(true);

  // Le refus du serveur s'affiche en bas d'un formulaire qui défile : sans
  // cela, un candidat dont la fenêtre est remontée cliquerait « Envoyer » une
  // seconde fois sans jamais voir pourquoi la première a échoué.
  const alerte = useRef<HTMLParagraphElement>(null);

  const info = useQuery({
    queryKey: ['public-job', slug],
    queryFn: () => api<PublicJobInfo>(`/public/jobs/${slug}`),
    retry: false,
  });

  const offre = info.data?.valid ? info.data : null;

  useEffect(() => {
    const cible = ancre.current;
    if (!cible) return;
    const obs = new IntersectionObserver(
      (entrees) => {
        const e = entrees[0];
        if (e) setAncreVisible(e.isIntersecting);
      },
      { threshold: 0 },
    );
    obs.observe(cible);
    return () => obs.disconnect();
  }, [offre, sent]);

  useEffect(() => {
    if (offre) document.title = `${offre.title} — ${offre.organizationName}`;
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
          phone: phone || undefined,
          message: message || undefined,
          documents: Object.entries(files).map(([label, f]) => ({
            label,
            filename: f.filename,
            contentType: f.contentType,
            contentBase64: f.contentBase64,
          })),
        },
      }),
    onSuccess: () => {
      setOuvert(false);
      setSent(true);
    },
    onError: (err) =>
      setServerError(err instanceof ApiError ? err.message : 'Envoi impossible — réessayez.'),
  });

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
      setFileError(`« ${file.name} » : format accepté — PDF, Word, JPG ou PNG.`);
      return;
    }
    if (file.size === 0) {
      setFileError(`« ${file.name} » est vide — vérifiez le fichier (synchronisation cloud ?).`);
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
        `Impossible de lire « ${file.name} » — réessayez ou choisissez un autre fichier.`,
      );
    reader.readAsDataURL(file);
  };

  if (info.isLoading) {
    return (
      <main className="min-h-dvh bg-bg">
        <div className="hero-bar h-[57px]" />
        <div className="mx-auto max-w-3xl px-5 py-8">
          <Skeleton className="mb-4 h-52 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  // Une erreur réseau/serveur n'est PAS « offre inexistante » : on distingue.
  if (info.isError) {
    return (
      <main className="min-h-dvh bg-bg">
        <Message
          icon="error"
          titre="Chargement impossible"
          action={
            <Button variant="secondary" onClick={() => void info.refetch()}>
              Réessayer
            </Button>
          }
        >
          Impossible de joindre le serveur — vérifiez votre connexion et réessayez.
        </Message>
      </main>
    );
  }

  if (!offre) {
    return (
      <main className="min-h-dvh bg-bg">
        <Message icon="event_busy" titre="Offre indisponible">
          {INVALID_MESSAGES[info.data && !info.data.valid ? info.data.reason : 'not_found']}
        </Message>
      </main>
    );
  }

  if (sent) {
    return (
      <main className="min-h-dvh bg-bg">
        <Bandeau organisation={offre.organizationName} />
        <Message ton="succes" icon="check_circle" titre="Candidature envoyée">
          <p>
            Merci {givenName}. Votre dossier pour « {offre.title} » est arrivé chez{' '}
            {offre.organizationName}. Le service des ressources humaines vous répondra à
            l&apos;adresse <span className="font-semibold text-ink">{email}</span>.
          </p>
          <p className="mt-3 text-[12px]">
            Référence à rappeler :{' '}
            <span className="font-mono font-bold text-ink-strong">{offre.reference}</span>
          </p>
        </Message>
      </main>
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

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <Bandeau organisation={offre.organizationName} />

      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-6 sm:py-8">
        {/* L'offre : ce qu'on propose, et les quelques faits qui décident. */}
        <Card>
          <CardContent className="py-6">
            <p className="text-[11px] font-extrabold tracking-[0.14em] text-primary uppercase">
              Offre d&apos;emploi
            </p>
            <h1 className="mt-1.5 text-[26px] leading-tight font-extrabold text-ink-strong sm:text-[30px]">
              {offre.title}
            </h1>

            <div className="mt-5 grid grid-cols-1 gap-4 border-t border-line-soft pt-5 sm:grid-cols-2">
              <Fait icon="badge" label="Type de contrat">
                {CONTRACT_LABELS[offre.contractType] ?? offre.contractType}
              </Fait>
              {offre.location ? (
                <Fait icon="place" label="Lieu">
                  {offre.location}
                </Fait>
              ) : null}
              <Fait icon="event" label="Date limite">
                {offre.deadline ? (
                  <>
                    {jourFr(offre.deadline)}
                    {compteRebours ? (
                      <span
                        className={cn(
                          'ml-1.5 text-[12px] font-bold',
                          urgence ? 'text-accent-text' : 'text-ink-muted',
                        )}
                      >
                        {restants === 0
                          ? '· dernier jour'
                          : `· plus que ${restants} jour${restants! > 1 ? 's' : ''}`}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="font-normal text-ink-muted">Sans date limite</span>
                )}
              </Fait>
              <Fait icon="description" label="Référence">
                <span className="font-mono">{offre.reference}</span>
              </Fait>
            </div>

            <div ref={ancre} className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button size="lg" onClick={() => setOuvert(true)}>
                Postuler à cette offre
              </Button>
              <p className="text-[12.5px] text-ink-muted">
                {offre.requiredDocuments.length > 0
                  ? `${offre.requiredDocuments.length} pièce${offre.requiredDocuments.length > 1 ? 's' : ''} à joindre`
                  : 'Aucune pièce à joindre'}{' '}
                · environ deux minutes
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6">
            <h2 className="mb-4 text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
              La mission
            </h2>
            <Description texte={offre.description} />
          </CardContent>
        </Card>

        {/* Ce qu'il faut avoir sous la main AVANT d'ouvrir le formulaire : un
            dossier abandonné en cours de route l'est presque toujours parce
            qu'on découvre la pièce manquante une fois la saisie commencée. */}
        {offre.requiredDocuments.length > 0 ? (
          <Card>
            <CardContent className="py-6">
              <h2 className="mb-1 text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
                À préparer
              </h2>
              <p className="mb-4 text-[13px] text-ink-muted">
                Rassemblez ces pièces avant de commencer — {FORMATS}, {POIDS_MAX}.
              </p>
              <ul className="flex flex-col gap-2">
                {offre.requiredDocuments.map((doc) => (
                  <li
                    key={doc}
                    className="flex items-center gap-2.5 rounded-[10px] bg-bg px-3.5 py-2.5"
                  >
                    <Icon name="description" size={18} className="shrink-0 text-primary/70" />
                    <span className="text-[13.5px] font-semibold text-ink-strong">{doc}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <p className="mt-1 text-center text-[11.5px] text-ink-muted">
          Propulsé par Teranga RH — vos données ne sont transmises qu&apos;à{' '}
          {offre.organizationName}.
        </p>
      </div>

      {/* Barre collante : sur une offre longue, « Postuler » ne doit jamais
          être à un défilement de distance. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-30 border-t border-line-soft bg-surface/95 backdrop-blur-sm transition-transform duration-200',
          ancreVisible ? 'translate-y-full' : 'translate-y-0',
        )}
        aria-hidden={ancreVisible}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-bold text-ink-strong">{offre.title}</p>
            <p className="truncate text-[11.5px] text-ink-muted">
              {CONTRACT_LABELS[offre.contractType] ?? offre.contractType}
              {offre.deadline ? ` · jusqu'au ${jourFr(offre.deadline)}` : ''}
            </p>
          </div>
          <Button onClick={() => setOuvert(true)} tabIndex={ancreVisible ? -1 : 0}>
            Postuler
          </Button>
        </div>
      </div>

      <Modal
        open={ouvert}
        onClose={() => setOuvert(false)}
        title="Postuler"
        subtitle={`${offre.title} · ${offre.reference}`}
        maxWidth="max-w-2xl"
        footer={
          <>
            <p className="w-full text-center text-[11.5px] text-ink-muted sm:mr-auto sm:w-auto sm:text-left">
              {manquants.length > 0
                ? `Reste à joindre : ${manquants.join(', ')}`
                : complet
                  ? 'Tout est prêt.'
                  : 'Renseignez vos nom, prénom et adresse email.'}
            </p>
            <Button variant="secondary" onClick={() => setOuvert(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => {
                setServerError(null);
                apply.mutate();
              }}
              disabled={!complet}
              loading={apply.isPending}
            >
              Envoyer ma candidature
            </Button>
          </>
        }
      >
        <ModalSection title="Vos coordonnées">
          <ModalGrid>
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
            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Téléphone" htmlFor="phone">
              <Input
                id="phone"
                type="tel"
                autoComplete="tel"
                placeholder="77 000 00 00"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </ModalGrid>
        </ModalSection>

        {offre.requiredDocuments.length > 0 ? (
          <ModalSection
            title="Vos pièces"
            extra={
              <span className="text-[11px] font-semibold text-ink-muted">
                {offre.requiredDocuments.length - manquants.length} sur{' '}
                {offre.requiredDocuments.length}
              </span>
            }
          >
            <div className="flex flex-col gap-2.5">
              {offre.requiredDocuments.map((label) => (
                <PieceJointe
                  key={label}
                  label={label}
                  fichier={files[label]}
                  onPick={(f) => pickFile(label, f)}
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
                className="mt-3 rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
              >
                {fileError}
              </p>
            ) : null}
          </ModalSection>
        ) : null}

        <ModalSection title="Votre message">
          <Field label="Quelques mots sur votre motivation (facultatif)" htmlFor="message">
            <Textarea
              id="message"
              rows={4}
              placeholder="Ce qui vous attire dans ce poste, ce que vous y apportez…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          {serverError ? (
            <p
              ref={alerte}
              role="alert"
              className="mt-3 rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger"
            >
              {serverError}
            </p>
          ) : null}
        </ModalSection>
      </Modal>
    </main>
  );
}
