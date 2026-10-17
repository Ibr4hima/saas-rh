'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type {
  DocumentDeLaListe,
  DocumentGenere,
  EmployeeListItem,
  EmployeeListPage,
  MyEmployeeView,
} from '@teranga/contracts';
import {
  demandeUnSalaire,
  enChiffres,
  estGenere,
  nomDuDocumentGenere,
  REQUESTABLE_DOC_LABELS,
  requestableDocSchema,
} from '@teranga/contracts';
import { Badge, Button, Card, CardTitle, cn, EmptyState } from '@teranga/ui';
import { Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import { PdfEnLargeur } from '../../../components/pdf-viewer';
import { ActionDuBandeau } from '../../../components/actions-bandeau';
import { api, ApiError } from '../../../lib/api';
import { enregistrerFichier, lireFichier } from '../../../lib/fichiers';

/*
   « Générer des documents » (ADR-0085), en trois temps qui se découvrent
   l'un après l'autre : le document, l'agent, puis le document lui-même, en
   largeur, à télécharger depuis le bandeau. Les deux choix se font comme on
   ouvre « Demander un document » : un bloc, son intitulé, et à sa droite le
   choix, en liste déroulante. Un document qui demande ce que le dossier ne
   porte pas, le salaire de l'attestation de revenu, le fait saisir avant
   (ADR-0087).

   L'aperçu EST le PDF, peint par pdf.js : un modèle de l'APIX se vérifie sur
   ce qui sortira, pas sur une imitation à l'écran.
*/

/**
 * La liste de la DCH, dans son ordre, en trois familles. La famille se lit
 * sur l'identifiant : un document ajouté à la liste y trouve sa place.
 */
const DOCUMENTS = requestableDocSchema.options;
const FAMILLES: readonly { titre: string; documents: readonly DocumentDeLaListe[] }[] = [
  { titre: 'Contrats', documents: DOCUMENTS.filter((d) => d.startsWith('contrat_')) },
  { titre: 'Attestations', documents: DOCUMENTS.filter((d) => d.startsWith('attestation_')) },
  {
    titre: 'Autres documents',
    documents: DOCUMENTS.filter((d) => !d.startsWith('contrat_') && !d.startsWith('attestation_')),
  },
];

/** Ceux qui s'ouvrent, dans l'ordre de la liste : le clavier passe de l'un à l'autre. */
const OUVRABLES: readonly DocumentGenere[] = DOCUMENTS.filter(estGenere);

const nomDe = (a: EmployeeListItem) => `${a.givenName} ${a.familyName}`;

/** Le cadre des deux listes déroulantes, celui de « Déléguer des tâches ». */
const CHAMP =
  'h-9 w-full rounded-[10px] border bg-surface text-[12.5px] transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none';
const MENU =
  'tg-menu absolute top-full right-0 left-0 z-30 mt-1.5 rounded-[14px] border border-card-line bg-surface p-1.5 shadow-lg';

/** Un salaire saisi, et l'agent pour qui : il ne passe pas d'un agent à l'autre. */
type Saisie = { agentId: string; salaire: number | null };

export default function GenererDesDocumentsPage() {
  const [choisi, setChoisi] = useState<DocumentGenere | null>(null);
  const [agent, setAgent] = useState<EmployeeListItem | null>(null);
  const [saisie, setSaisie] = useState<Saisie | null>(null);
  // L'aperçu suit la saisie une fois la frappe posée, pas à chaque chiffre.
  const [retenue, setRetenue] = useState<Saisie | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setRetenue(saisie), 450);
    return () => clearTimeout(t);
  }, [saisie]);

  const pourLAgent = (s: Saisie | null) => (s && s.agentId === agent?.id ? s.salaire : null);
  const salaire = pourLAgent(saisie);
  const salaireRetenu = pourLAgent(retenue);
  const avecSalaire = choisi !== null && demandeUnSalaire(choisi);

  return (
    <Page>
      <Etape titre="Sélectionner le document à générer">
        <ChoixDuDocument choisi={choisi} onChoisir={setChoisi} />
      </Etape>
      {choisi ? (
        <Etape titre="Sélectionner l’agent">
          <ChoixDeLAgent agent={agent} onChoisir={setAgent} />
        </Etape>
      ) : null}
      {agent && avecSalaire ? (
        <Etape titre="Saisir le salaire net mensuel">
          <ChampDuSalaire
            key={agent.id}
            salaire={salaire}
            onSaisir={(s) => setSaisie({ agentId: agent.id, salaire: s })}
          />
        </Etape>
      ) : null}
      {choisi && agent && (!avecSalaire || salaireRetenu !== null) ? (
        <Apercu
          choisi={choisi}
          agent={agent}
          salaire={avecSalaire ? salaireRetenu : null}
          enCours={avecSalaire && salaire !== salaireRetenu}
        />
      ) : null}
    </Page>
  );
}

/** Un temps du parcours, en bloc : son intitulé à gauche, son choix à droite. */
function Etape({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
        <CardTitle className="min-w-0 flex-1">{titre}</CardTitle>
        <div className="w-full sm:w-[23rem] sm:shrink-0">{children}</div>
      </div>
    </Card>
  );
}

/**
 * Le document à générer, dans une liste déroulante, par familles. Un seul se
 * choisit : la pastille de chaque ligne est ronde. Un document dont le
 * modèle reste à venir se lit sans se choisir.
 */
function ChoixDuDocument({
  choisi,
  onChoisir,
}: {
  choisi: DocumentGenere | null;
  onChoisir: (d: DocumentGenere) => void;
}) {
  const id = useId();
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [courant, setCourant] = useState<DocumentGenere | null>(null);
  const fermer = () => setOuvert(false);
  // Un clic hors de la liste la referme.
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e: PointerEvent) => {
      if (!racine.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener('pointerdown', auClic);
    return () => document.removeEventListener('pointerdown', auClic);
  }, [ouvert]);

  const ouvrir = () => {
    setCourant(choisi ?? OUVRABLES[0] ?? null);
    setOuvert(true);
  };
  const choisir = (d: DocumentGenere) => {
    onChoisir(d);
    setOuvert(false);
    bouton.current?.focus();
  };
  const deplacer = (vers: 'suivant' | 'precedent' | 'premier' | 'dernier') => {
    const i = courant ? OUVRABLES.indexOf(courant) : -1;
    const cible =
      vers === 'premier'
        ? 0
        : vers === 'dernier'
          ? OUVRABLES.length - 1
          : vers === 'suivant'
            ? Math.min(i + 1, OUVRABLES.length - 1)
            : Math.max(i - 1, 0);
    setCourant(OUVRABLES[cible] ?? null);
  };

  // Au clavier, la ligne désignée reste en vue.
  useEffect(() => {
    if (ouvert && courant) {
      document.getElementById(`${id}-${courant}`)?.scrollIntoView({ block: 'nearest' });
    }
  }, [id, ouvert, courant]);

  return (
    <div ref={racine} className="relative">
      <button
        ref={bouton}
        type="button"
        role="combobox"
        aria-label="Document à générer"
        aria-haspopup="listbox"
        aria-expanded={ouvert}
        aria-controls={`${id}-liste`}
        aria-activedescendant={ouvert && courant ? `${id}-${courant}` : undefined}
        onClick={() => (ouvert ? fermer() : ouvrir())}
        onKeyDown={(e) => {
          const touches: Record<string, () => void> = {
            ArrowDown: () => (ouvert ? deplacer('suivant') : ouvrir()),
            ArrowUp: () => (ouvert ? deplacer('precedent') : ouvrir()),
            Home: () => ouvert && deplacer('premier'),
            End: () => ouvert && deplacer('dernier'),
            Enter: () => (ouvert && courant ? choisir(courant) : ouvrir()),
            ' ': () => (ouvert && courant ? choisir(courant) : ouvrir()),
            Escape: fermer,
          };
          const geste = touches[e.key];
          if (geste) {
            e.preventDefault();
            geste();
          } else if (e.key === 'Tab') {
            fermer();
          }
        }}
        className={cn(
          CHAMP,
          'flex items-center gap-2 pr-2 pl-3 text-left',
          ouvert ? 'border-primary' : 'border-line hover:border-ink-muted/40',
        )}
      >
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            choisi ? 'font-medium text-ink-strong' : 'text-ink-muted',
          )}
        >
          {choisi ? REQUESTABLE_DOC_LABELS[choisi] : 'Choisir un document'}
        </span>
        <Icon
          name="chevron_right"
          size={16}
          className={cn(
            'shrink-0 text-ink-muted transition-transform duration-150',
            ouvert ? '-rotate-90' : 'rotate-90',
          )}
        />
      </button>

      {ouvert ? (
        <div className={MENU}>
          <div
            id={`${id}-liste`}
            role="listbox"
            aria-label="Documents"
            className="max-h-[22rem] overflow-y-auto sm:max-h-[min(78vh,44rem)]"
          >
            {FAMILLES.map((f) => (
              <div key={f.titre} role="group" aria-labelledby={`${id}-${f.titre}`}>
                <p
                  id={`${id}-${f.titre}`}
                  className="px-2.5 pt-2 pb-1 text-[11px] font-semibold text-ink-muted"
                >
                  {f.titre}
                </p>
                {f.documents.map((d) =>
                  estGenere(d) ? (
                    <div
                      key={d}
                      id={`${id}-${d}`}
                      role="option"
                      aria-selected={d === choisi}
                      // Le bouton garde le focus : la liste se ferme sur son départ.
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setCourant(d)}
                      onClick={() => choisir(d)}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-150',
                        d === choisi ? 'bg-primary/[0.06]' : d === courant ? 'bg-hover' : undefined,
                      )}
                    >
                      <Pastille choisie={d === choisi} />
                      <span
                        className={cn(
                          'min-w-0 flex-1 text-[13px]',
                          d === choisi ? 'font-semibold text-ink-strong' : 'text-ink',
                        )}
                      >
                        {REQUESTABLE_DOC_LABELS[d]}
                      </span>
                    </div>
                  ) : (
                    <div
                      key={d}
                      role="option"
                      aria-selected={false}
                      aria-disabled
                      className="flex items-center gap-3 rounded-[10px] px-2.5 py-2"
                    >
                      <Pastille choisie={false} eteinte />
                      <span className="min-w-0 flex-1 text-[13px] text-ink-muted/75">
                        {REQUESTABLE_DOC_LABELS[d]}
                      </span>
                      <span className="shrink-0 text-[10.5px] whitespace-nowrap text-ink-muted/75">
                        À venir
                      </span>
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** La pastille d'un choix exclusif : ronde, pleine au centre une fois choisie. */
function Pastille({ choisie, eteinte = false }: { choisie: boolean; eteinte?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-full border bg-surface transition-colors duration-150',
        choisie ? 'border-primary' : 'border-line',
        eteinte && 'opacity-40',
      )}
    >
      {choisie ? <span className="size-2 rounded-full bg-primary" /> : null}
    </span>
  );
}

/**
 * L'agent : nom ou matricule, dossiers en activité ou non (un certificat de
 * travail se délivre au départ). Le champ montre le nom retenu ; y écrire
 * en cherche un autre, et le quitter sans choisir garde le premier. Jamais
 * soi : son propre dossier ne se génère pas d'ici.
 */
function ChoixDeLAgent({
  agent,
  onChoisir,
}: {
  agent: EmployeeListItem | null;
  onChoisir: (a: EmployeeListItem) => void;
}) {
  const id = useId();
  const [texte, setTexte] = useState(agent ? nomDe(agent) : '');
  const [cherche, setCherche] = useState('');
  const [ouverte, setOuverte] = useState(false);
  const [courant, setCourant] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setCherche(texte.trim()), 200);
    return () => clearTimeout(t);
  }, [texte]);
  useEffect(() => {
    setCourant(0);
  }, [cherche]);
  // Au clavier, la ligne désignée reste en vue.
  useEffect(() => {
    document.getElementById(`${id}-${courant}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, courant]);

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

  const remettre = () => setTexte(agent ? nomDe(agent) : '');
  const choisir = (a: EmployeeListItem | undefined) => {
    if (!a) return;
    setOuverte(false);
    setTexte(nomDe(a));
    onChoisir(a);
  };

  return (
    <div className="relative">
      <Icon
        name="search"
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted/70"
      />
      <input
        role="combobox"
        aria-label="Agent"
        aria-expanded={visible}
        aria-controls={`${id}-liste`}
        aria-autocomplete="list"
        aria-activedescendant={visible && agents[courant] ? `${id}-${courant}` : undefined}
        autoComplete="off"
        placeholder="Nom ou matricule…"
        value={texte}
        onChange={(e) => {
          setTexte(e.target.value);
          setOuverte(true);
        }}
        // Tant que le champ montre le nom retenu, y entrer en sélectionne tout
        // le nom : on écrit par-dessus pour en chercher un autre. Au clic, le
        // navigateur poserait le curseur au relâché et défairait la sélection :
        // le clic la pose lui-même.
        onFocus={(e) => e.target.select()}
        onMouseDown={(e) => {
          if (!agent || texte !== nomDe(agent)) return;
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.select();
        }}
        onBlur={() => {
          setOuverte(false);
          remettre();
        }}
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
            remettre();
          }
        }}
        className={cn(
          CHAMP,
          'border-line pr-3 pl-8 font-medium text-ink-strong placeholder:font-normal placeholder:text-ink-muted hover:border-ink-muted/40 focus:border-primary',
        )}
      />
      {visible ? (
        <div className={MENU}>
          <ul
            id={`${id}-liste`}
            role="listbox"
            aria-label="Agents"
            className="max-h-72 overflow-y-auto"
          >
            {agents.length === 0 ? (
              <li className="px-2.5 py-2 text-[12.5px] text-ink-muted">
                {resultats.isFetching ? 'Recherche…' : 'Aucun résultat'}
              </li>
            ) : (
              agents.map((a, i) => (
                <li
                  key={a.id}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={a.id === agent?.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setCourant(i)}
                  onClick={() => choisir(a)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors duration-150',
                    a.id === agent?.id ? 'bg-primary/[0.06]' : i === courant ? 'bg-hover' : null,
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink-strong">
                      {nomDe(a)}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-muted">
                      <span className="font-mono">{a.employeeNumber}</span>
                      {a.positionTitle ? ` · ${a.positionTitle}` : null}
                    </span>
                  </span>
                  {a.status !== 'active' ? (
                    <Badge className="shrink-0">Dossier inactif</Badge>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Le salaire net mensuel, en francs CFA et en chiffres : les milliers se
 * séparent à la frappe, et le curseur garde sa place parmi les chiffres. Le
 * champ s'ouvre prêt à écrire, dès le choix de l'agent.
 */
function ChampDuSalaire({
  salaire,
  onSaisir,
}: {
  salaire: number | null;
  onSaisir: (salaire: number | null) => void;
}) {
  const champ = useRef<HTMLInputElement>(null);
  const curseur = useRef<number | null>(null);
  const [texte, setTexte] = useState(salaire ? enChiffres(salaire) : '');

  // Après le regroupement, le curseur revient derrière autant de chiffres
  // qu'avant : une espace ajoutée ne le fait pas sauter.
  useLayoutEffect(() => {
    const chiffres = curseur.current;
    if (chiffres === null || !champ.current) return;
    curseur.current = null;
    let i = 0;
    for (let vus = 0; i < texte.length && vus < chiffres; i++) {
      if (/\d/.test(texte[i]!)) vus++;
    }
    champ.current.setSelectionRange(i, i);
  }, [texte]);

  return (
    <div className="relative">
      <input
        ref={champ}
        autoFocus
        inputMode="numeric"
        autoComplete="off"
        aria-label="Salaire net mensuel, en francs CFA"
        placeholder="Montant en chiffres"
        // « 999 999 999 » : neuf chiffres et leurs deux espaces.
        maxLength={11}
        value={texte}
        onChange={(e) => {
          const brut = e.target.value;
          const avant = brut
            .slice(0, e.target.selectionStart ?? brut.length)
            .replace(/\D/g, '').length;
          const chiffres = brut.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
          curseur.current = Math.min(avant, chiffres.length);
          setTexte(chiffres ? enChiffres(Number(chiffres)) : '');
          onSaisir(chiffres ? Number(chiffres) : null);
        }}
        className={cn(
          CHAMP,
          'border-line pr-14 pl-3 font-medium text-ink-strong tabular-nums placeholder:font-normal placeholder:text-ink-muted hover:border-ink-muted/40 focus:border-primary',
        )}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11.5px] font-semibold text-ink-muted"
      >
        FCFA
      </span>
    </div>
  );
}

/**
 * Le document, tel qu'il sortira : en largeur, comme le procès-verbal
 * d'apix-e-voting, sans rien au-dessus. « Télécharger » se pose dans le
 * bandeau de tête dès que le PDF est prêt, et s'en retire tant qu'un salaire
 * en cours de frappe ne s'y lit pas encore : on n'enregistre pas l'ancien
 * montant.
 */
function Apercu({
  choisi,
  agent,
  salaire,
  enCours,
}: {
  choisi: DocumentGenere;
  agent: EmployeeListItem;
  salaire: number | null;
  enCours: boolean;
}) {
  const pdf = useQuery({
    queryKey: ['document-genere', choisi, agent.id, salaire],
    // En POST : le salaire reste hors de l'adresse.
    queryFn: ({ signal }) =>
      lireFichier(`/employees/${agent.id}/generer/${choisi}`, {
        signal,
        corps: salaire === null ? {} : { salaire },
      }),
    retry: false,
    // Un autre salaire pour le même document et le même agent : l'ancien PDF
    // reste à l'écran le temps du nouveau, la page ne clignote pas.
    placeholderData: (precedent, requete) =>
      requete?.queryKey[1] === choisi && requete.queryKey[2] === agent.id ? precedent : undefined,
  });
  const aJour = !enCours && !pdf.isPlaceholderData;

  if (pdf.isError) {
    return (
      <Card>
        <Refus erreur={pdf.error} onReessayer={() => void pdf.refetch()} />
      </Card>
    );
  }
  const contenu = pdf.data;
  if (!contenu) {
    // Une feuille blanche, le temps que le PDF arrive : rien ne saute à son arrivée.
    return (
      <div className="grid aspect-[595/842] place-items-center rounded-[16px] bg-white shadow-xs ring-1 ring-card-line">
        <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }
  return (
    <>
      {aJour ? (
        <ActionDuBandeau
          icon="download"
          label="Télécharger"
          onClick={() =>
            enregistrerFichier(
              new Blob([contenu], { type: 'application/pdf' }),
              nomDuDocumentGenere(choisi, agent.employeeNumber),
            )
          }
        />
      ) : null}
      <div className={cn('transition-opacity duration-200', !aJour && 'opacity-55')}>
        <PdfEnLargeur
          data={contenu}
          titre={`${REQUESTABLE_DOC_LABELS[choisi]} : ${nomDe(agent)}`}
        />
      </div>
    </>
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
