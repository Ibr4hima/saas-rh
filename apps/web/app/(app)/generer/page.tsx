'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  DocumentDeLaListe,
  DocumentGenere,
  EmployeeListItem,
  EmployeeListPage,
  MyEmployeeView,
} from '@teranga/contracts';
import {
  estGenere,
  nomDuDocumentGenere,
  REQUESTABLE_DOC_LABELS,
  requestableDocSchema,
} from '@teranga/contracts';
import { Badge, Button, Card, CardHeader, CardTitle, cn, EmptyState, Input } from '@teranga/ui';
import { Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { PdfViewer } from '../../../components/pdf-viewer';
import { api, ApiError, apiUrl } from '../../../lib/api';
import { enregistrerFichier, lireFichier } from '../../../lib/fichiers';

/*
   « Générer des documents » (ADR-0085) : qui dirige la DCH choisit un
   document de la liste et un agent, voit le document tel qu'il sortira, puis
   l'ouvre pour l'imprimer ou l'enregistre. L'aperçu EST le PDF, lu par le
   lecteur du produit : un modèle de l'APIX se vérifie sur ce qui sortira,
   pas sur une imitation à l'écran.

   Les documents dont le modèle n'est pas encore configuré gardent leur place
   dans la liste, sans s'ouvrir.
*/

/**
 * La liste de la DCH, dans son ordre, en trois familles. La famille se lit
 * sur l'identifiant : un document ajouté à la liste y trouve sa place.
 *
 * Sur deux colonnes, les attestations en occupent une à elles seules : les
 * contrats et les autres documents s'empilent dans l'autre, sans trou.
 */
const DOCUMENTS = requestableDocSchema.options;
const FAMILLES: readonly {
  titre: string;
  documents: readonly DocumentDeLaListe[];
  colonne?: boolean;
}[] = [
  { titre: 'Contrats', documents: DOCUMENTS.filter((d) => d.startsWith('contrat_')) },
  {
    titre: 'Attestations',
    documents: DOCUMENTS.filter((d) => d.startsWith('attestation_')),
    colonne: true,
  },
  {
    titre: 'Autres documents',
    documents: DOCUMENTS.filter((d) => !d.startsWith('contrat_') && !d.startsWith('attestation_')),
  },
];

const nomDe = (a: EmployeeListItem) => `${a.givenName} ${a.familyName}`;

export default function GenererDesDocumentsPage() {
  const [choisi, setChoisi] = useState<DocumentGenere | null>(null);
  const [agent, setAgent] = useState<EmployeeListItem | null>(null);
  const atelier = useRef<HTMLDivElement>(null);

  return (
    <Page>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <ListeDesDocuments
          choisi={choisi}
          onChoisir={(d) => {
            setChoisi(d);
            // Sur un écran étroit, l'atelier est sous la liste : on l'amène.
            if (window.matchMedia('(max-width: 1279.98px)').matches) {
              atelier.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
        />
        <div ref={atelier} className="min-w-0 flex-1 scroll-mt-4">
          <Atelier choisi={choisi} agent={agent} onAgent={setAgent} />
        </div>
      </div>
    </Page>
  );
}

/** Les documents de la liste, par familles ; ceux dont le modèle reste à venir ne s'ouvrent pas. */
function ListeDesDocuments({
  choisi,
  onChoisir,
}: {
  choisi: DocumentGenere | null;
  onChoisir: (d: DocumentGenere) => void;
}) {
  return (
    <Card className="xl:w-[19.5rem] xl:shrink-0">
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <div className="grid gap-x-4 gap-y-4 px-3 pb-4 sm:grid-cols-2 xl:grid-cols-1">
        {FAMILLES.map((f) => (
          <section key={f.titre} className={cn(f.colonne && 'sm:row-span-2 xl:row-span-1')}>
            <h3 className="px-2.5 pb-1 text-[11px] font-semibold text-ink-muted">{f.titre}</h3>
            <ul className="flex flex-col gap-0.5">
              {f.documents.map((d) => {
                const actif = d === choisi;
                return (
                  <li key={d}>
                    {estGenere(d) ? (
                      <button
                        type="button"
                        aria-pressed={actif}
                        onClick={() => onChoisir(d)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-[12.5px] leading-snug transition-colors duration-150',
                          'focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none',
                          actif
                            ? 'bg-primary/[0.07] font-semibold text-primary ring-1 ring-primary/30 ring-inset'
                            : 'font-medium text-ink-strong hover:bg-hover',
                        )}
                      >
                        <span className="min-w-0 flex-1">{REQUESTABLE_DOC_LABELS[d]}</span>
                        <Icon
                          name="chevron_right"
                          size={16}
                          className={cn('shrink-0', actif ? 'text-primary' : 'text-ink-muted/70')}
                        />
                      </button>
                    ) : (
                      <p className="flex items-baseline gap-2 px-2.5 py-1.5 text-[12.5px] leading-snug text-ink-muted">
                        <span className="min-w-0 flex-1">{REQUESTABLE_DOC_LABELS[d]}</span>
                        <span className="shrink-0 text-[10.5px] whitespace-nowrap text-ink-muted/80">
                          À venir
                        </span>
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}

/** L'agent, l'aperçu du document, et ce qu'on en fait : l'ouvrir pour l'imprimer, l'enregistrer. */
function Atelier({
  choisi,
  agent,
  onAgent,
}: {
  choisi: DocumentGenere | null;
  agent: EmployeeListItem | null;
  onAgent: (a: EmployeeListItem | null) => void;
}) {
  const chemin = choisi && agent ? `/employees/${agent.id}/generer/${choisi}` : null;
  const pdf = useQuery({
    queryKey: ['document-genere', choisi, agent?.id],
    queryFn: ({ signal }) => lireFichier(chemin!, signal),
    enabled: chemin !== null,
    retry: false,
  });
  const pret = chemin !== null && pdf.data !== undefined;

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 border-b border-line-soft px-4 py-3 sm:px-5">
        <ChoixAgent agent={agent} onChoisir={onAgent} />
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!pret}
            onClick={() =>
              window.open(apiUrl(`${chemin}?disposition=inline`), '_blank', 'noopener')
            }
          >
            <Icon name="picture_as_pdf" size={15} />
            Ouvrir le PDF
          </Button>
          <Button
            size="sm"
            disabled={!pret}
            onClick={() => {
              if (!pdf.data || !choisi || !agent) return;
              enregistrerFichier(
                new Blob([pdf.data], { type: 'application/pdf' }),
                nomDuDocumentGenere(choisi, agent.employeeNumber),
              );
            }}
          >
            <Icon name="download" size={15} />
            Télécharger
          </Button>
        </div>
      </div>

      <div className="h-[72vh] min-h-[26rem] xl:h-[min(80vh,62rem)]">
        {!choisi || !agent ? (
          <EmptyState
            className="h-full"
            icon={<Icon name="description" size={22} />}
            title={
              !choisi && !agent
                ? 'Choisissez un document et un agent'
                : !choisi
                  ? 'Choisissez un document'
                  : 'Choisissez un agent'
            }
          />
        ) : pdf.isError ? (
          <Refus erreur={pdf.error} onReessayer={() => void pdf.refetch()} />
        ) : pdf.data ? (
          <PdfViewer
            data={pdf.data}
            titre={`${REQUESTABLE_DOC_LABELS[choisi]} · ${nomDe(agent)}`}
          />
        ) : (
          <div className="grid h-full place-items-center bg-bg">
            <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        )}
      </div>
    </Card>
  );
}

/**
 * Ce que l'API a refusé, en ses mots : un dossier inactif pour une
 * attestation, par exemple. Un refus ne se retente pas ; une panne, si.
 */
function Refus({ erreur, onReessayer }: { erreur: Error; onReessayer: () => void }) {
  const probleme = erreur instanceof ApiError ? erreur.problem : null;
  const refus = probleme !== null && probleme.status >= 400 && probleme.status < 500;
  return (
    <EmptyState
      className="h-full"
      icon={<Icon name="error" size={22} />}
      title={probleme?.title ?? 'Génération impossible'}
      description={probleme?.detail ?? (refus ? undefined : 'Réessayez dans un instant.')}
      action={
        refus ? undefined : (
          <Button size="sm" variant="secondary" onClick={onReessayer}>
            Réessayer
          </Button>
        )
      }
    />
  );
}

/** L'agent choisi, ou la recherche qui le trouve. */
function ChoixAgent({
  agent,
  onChoisir,
}: {
  agent: EmployeeListItem | null;
  onChoisir: (a: EmployeeListItem | null) => void;
}) {
  // « Changer » rend la main à la recherche, curseur dedans.
  const [enChangement, setEnChangement] = useState(false);
  if (!agent) {
    return <RechercheAgent focus={enChangement} onChoisir={onChoisir} />;
  }
  const precisions = [agent.positionTitle, agent.directionShortName ?? agent.orgUnitName].filter(
    Boolean,
  );
  return (
    <div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13.5px] leading-tight font-bold text-ink-strong">
            {nomDe(agent)}
          </span>
          {agent.status !== 'active' ? <Badge className="shrink-0">Dossier inactif</Badge> : null}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] leading-tight text-ink-muted">
          <span className="font-mono">{agent.employeeNumber}</span>
          {precisions.length > 0 ? ` · ${precisions.join(' · ')}` : null}
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0"
        onClick={() => {
          setEnChangement(true);
          onChoisir(null);
        }}
      >
        Changer
      </Button>
    </div>
  );
}

/**
 * La recherche d'un agent : nom ou matricule, dossiers en activité ou non
 * (un certificat de travail se délivre au départ). Jamais soi : son propre
 * dossier ne se génère pas d'ici.
 */
function RechercheAgent({
  focus,
  onChoisir,
}: {
  focus: boolean;
  onChoisir: (a: EmployeeListItem) => void;
}) {
  const id = useId();
  const [texte, setTexte] = useState('');
  const [cherche, setCherche] = useState('');
  const [ouverte, setOuverte] = useState(false);
  const [courant, setCourant] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setCherche(texte.trim()), 200);
    return () => clearTimeout(t);
  }, [texte]);

  const moi = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const resultats = useQuery({
    queryKey: ['employees', 'generer', cherche],
    queryFn: ({ signal }) =>
      api<EmployeeListPage>(
        `/employees?q=${encodeURIComponent(cherche)}&sort=name&dir=asc&limit=8`,
        { signal },
      ),
    enabled: cherche.length > 0,
  });
  const agents = (resultats.data?.items ?? []).filter((a) => a.id !== moi.data?.employeeId);
  const visible = ouverte && cherche.length > 0;

  useEffect(() => {
    setCourant(0);
  }, [cherche]);
  // Au clavier, l'option courante reste en vue dans la liste.
  useEffect(() => {
    document.getElementById(`${id}-${courant}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, courant]);

  const choisir = (a: EmployeeListItem | undefined) => {
    if (!a) return;
    setOuverte(false);
    onChoisir(a);
  };

  return (
    <div className="relative min-w-0 flex-1 basis-64">
      <Icon
        name="search"
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted/70"
      />
      <Input
        role="combobox"
        aria-label="Rechercher un agent"
        aria-expanded={visible}
        aria-controls={`${id}-liste`}
        aria-autocomplete="list"
        aria-activedescendant={visible && agents[courant] ? `${id}-${courant}` : undefined}
        autoFocus={focus}
        placeholder="Agent : nom ou matricule…"
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          setOuverte(true);
        }}
        onFocus={() => setOuverte(true)}
        onBlur={() => setOuverte(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOuverte(true);
            setCourant((c) => Math.min(c + 1, Math.max(agents.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCourant((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter' && visible) {
            e.preventDefault();
            choisir(agents[courant]);
          } else if (e.key === 'Escape') {
            setOuverte(false);
          }
        }}
        className="h-9 rounded-full pl-8 text-[13px]"
      />
      {visible ? (
        <ul
          id={`${id}-liste`}
          role="listbox"
          aria-label="Agents"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-20 max-h-80 overflow-y-auto rounded-[14px] border border-line bg-surface p-1 shadow-lg"
        >
          {agents.length === 0 ? (
            <li className="px-3 py-2.5 text-[12.5px] text-ink-muted">
              {resultats.isFetching ? 'Recherche…' : 'Aucun résultat'}
            </li>
          ) : (
            agents.map((a, i) => (
              <li
                key={a.id}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === courant}
                // Le champ garde le focus : la liste se ferme sur son départ.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCourant(i)}
                onClick={() => choisir(a)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2',
                  i === courant && 'bg-hover',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-ink-strong">
                    {nomDe(a)}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    <span className="font-mono">{a.employeeNumber}</span>
                    {a.positionTitle ? ` · ${a.positionTitle}` : null}
                  </span>
                </span>
                {a.status !== 'active' ? <Badge className="shrink-0">Dossier inactif</Badge> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
