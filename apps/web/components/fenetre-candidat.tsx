'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ApplicationView } from '@teranga/contracts';
import { Badge, Button, Card, CardContent, cn } from '@teranga/ui';
import { apiUrl } from '../lib/api';
import { formatDate } from '../lib/hooks';
import { libelleDocument } from '../lib/recruitment';
import { ApercuDocument, type ViewableDoc } from './doc-viewer';
import { Icon, type IconName } from './icons';
import { Modal } from './modal';
import { Telephone, telHref } from './telephone';

/** Un moyen de joindre le candidat, en un clic. */
function Joindre({
  href,
  icon,
  children,
}: {
  href: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-bg px-2 py-[3px] text-[11.5px] font-semibold text-ink transition-colors hover:bg-primary/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
    >
      <Icon name={icon} size={13} className="shrink-0 text-ink-muted" />
      <span className="truncate">{children}</span>
    </a>
  );
}

/**
 * Le dossier ouvert EST la pièce qu'on vient lire.
 *
 * On ouvre une candidature pour lire un CV, pas pour arriver sur une liste
 * de fichiers et cliquer une deuxième fois. La fenêtre affiche donc
 * directement la première pièce, et les autres s'atteignent par les onglets
 * de son en-tête. Le message du candidat, quand il en a écrit un, est un
 * onglet comme les autres : il ne mérite pas de repousser le CV plus bas,
 * mais il ne mérite pas non plus de disparaître.
 */
export function FenetreCandidat({
  dossier: a,
  onClose,
  onRejeter,
}: {
  dossier: ApplicationView | null;
  onClose: () => void;
  /** Absent : le dossier se lit sans décision à prendre. */
  onRejeter?: () => void;
}) {
  const [onglet, setOnglet] = useState(0);

  // Le dossier change : on repart de sa première pièce.
  useEffect(() => setOnglet(0), [a?.id]);

  // Une pièce ouverte se télécharge une fois : chaque téléchargement se trace
  // (qui a lu quel CV), un nouveau rendu ne doit pas la redemander.
  const vues = useMemo(
    () =>
      (a?.documents ?? []).map((d) => ({
        cle: d.id,
        titre: d.label,
        doc: {
          url: apiUrl(`/application-documents/${d.id}`),
          filename: d.filename,
          contentType: d.contentType,
          titre: libelleDocument(d.label),
        } satisfies ViewableDoc,
      })),
    [a?.documents],
  );

  if (!a) return null;

  // L'onglet retenu peut dépasser après une suppression de pièce : on le
  // ramène dans les bornes ici plutôt que de laisser une vue vide.
  const index = Math.min(onglet, Math.max(0, vues.length - 1));
  const courante = vues[index] ?? null;

  return (
    <Modal
      open
      onClose={onClose}
      avatar={
        <span className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-[14px] font-bold text-primary uppercase">
          {a.givenName[0]}
          {a.familyName[0]}
        </span>
      }
      title={`${a.givenName} ${a.familyName}`}
      subtitle={
        // Le courriel et le téléphone deviennent CLIQUABLES : c'est par là
        // qu'on rappelle un candidat, et les recopier à la main était le
        // geste le plus probable de cette fenêtre.
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <Joindre href={`mailto:${a.email}`} icon="mail">
            {a.email}
          </Joindre>
          {a.phone ? (
            // Le lien porte le numéro INTERNATIONAL : composer « 764443322 »
            // depuis un poste hors du Sénégal ne mène nulle part.
            <Joindre href={`tel:${telHref(a.phone) ?? a.phone}`} icon="call">
              <Telephone valeur={a.phone} lien={false} />
            </Joindre>
          ) : null}
          <span className="inline-flex items-center gap-1.5 px-1 text-[11.5px] text-ink-muted">
            <Icon name="event" size={13} className="shrink-0 text-ink-muted/70" />
            Candidature du {formatDate(a.createdAt.slice(0, 10))}
          </span>
        </span>
      }
      maxWidth="max-w-4xl"
      enTete={
        vues.length > 1 ? (
          <div className="flex items-center gap-0.5 rounded-full bg-bg p-0.5">
            {vues.map((v, i) => (
              <button
                key={v.cle}
                type="button"
                onClick={() => setOnglet(i)}
                aria-pressed={i === index}
                className={cn(
                  'rounded-full px-3 py-1 text-[11.5px] font-bold whitespace-nowrap transition-colors',
                  i === index
                    ? 'bg-surface text-primary shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {v.titre}
              </button>
            ))}
          </div>
        ) : null
      }
      footer={
        // Les deux décisions du tri. Rejeter envoie au candidat un courriel de
        // refus, après confirmation ; la présélection n'agit pas encore.
        <div className="flex w-full items-center justify-end gap-2">
          {a.stage === 'rejected' ? (
            <Badge tone="rouge">Candidature non retenue</Badge>
          ) : !onRejeter ? null : (
            <>
              <Button variant="secondary" size="sm" onClick={onRejeter}>
                Rejeter
              </Button>
              <Button size="sm">Présélectionner</Button>
            </>
          )}
        </div>
      }
    >
      {courante === null ? (
        <Card>
          <CardContent className="py-10 text-center text-[13px] text-ink-muted">
            Ce dossier ne contient aucune pièce.
          </CardContent>
        </Card>
      ) : (
        // Hauteur fixée plutôt que `h-full` : la fenêtre se dimensionne sur son
        // contenu, et un enfant qui demande « toute la hauteur » d'un parent
        // sans hauteur propre se réduit à zéro.
        <div className="h-[min(68vh,660px)] overflow-hidden rounded-[12px] border border-card-line">
          {/* La clé force un lecteur NEUF par pièce : sans elle, passer du CV à
              la lettre réutiliserait l'état de défilement et de zoom du
              précédent, et la première page s'afficherait au mauvais endroit. */}
          <ApercuDocument key={courante.cle} doc={courante.doc} />
        </div>
      )}
    </Modal>
  );
}
