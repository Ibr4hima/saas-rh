'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import type {
  DocumentGenere,
  EmployeeListItem,
  EmployeeListPage,
  MyEmployeeView,
  Saisie,
} from '@teranga/contracts';
import {
  CATEGORIE_MAX,
  estGenere,
  ficheDeclarationMouvementSchema,
  ficheDeLaDecisionSchema,
  ficheDomiciliationSchema,
  ficheDuContratSchema,
  ficheStagiaireSchema,
  nomDuDocumentGenere,
  peutGenerer,
  REQUESTABLE_DOC_LABELS,
  saisiesDe,
  sansAgent,
} from '@teranga/contracts';
import { Badge, Button, Card, cn, EmptyState, Field } from '@teranga/ui';
import { Page } from '../../../components/gabarit';
import { Icon } from '../../../components/icons';
import {
  CHAMP,
  DANS_L_ORDRE,
  DEFILEMENT,
  Etape,
  ListeDesDocuments,
  MENU,
} from '../../../components/liste-des-documents';
import { PdfEnLargeur } from '../../../components/pdf-viewer';
import { ActionDeLEntete } from '../../../components/entete';
import {
  CONTRAT_VIDE,
  FicheDuContratDeTravail,
  versLaFicheDuContrat,
  type SaisieDuContrat,
} from '../../../components/fiche-contrat-travail';
import {
  DECLARATION_VIDE,
  FicheDeLaDeclaration,
  versLaFicheDeLaDeclaration,
  type SaisieDeLaDeclaration,
} from '../../../components/fiche-declaration-mouvement';
import {
  DECISION_VIDE,
  FicheDeLaDecision,
  versLaFicheDeLaDecision,
  type SaisieDeLaDecision,
} from '../../../components/fiche-decision-disponibilite';
import {
  DOMICILIATION_VIDE,
  FicheDeLaDomiciliation,
  versLaFicheDeLaDomiciliation,
  type SaisieDeLaDomiciliation,
} from '../../../components/fiche-domiciliation';
import {
  FicheDuStagiaire,
  STAGIAIRE_VIDE,
  versLaFiche,
  type SaisieDuStagiaire,
} from '../../../components/fiche-stagiaire';
import { Groupe, Preremplissage } from '../../../components/saisie-de-fiche';
import { api, ApiError } from '../../../lib/api';
import { enregistrerFichier, lireFichier } from '../../../lib/fichiers';
import { useMe } from '../../../lib/hooks';
import { champDuMontant } from '../../../lib/montant';

/*
   « Générer des documents » (ADR-0085), en trois temps qui se découvrent
   l'un après l'autre : le document, le préremplissage, puis le document
   lui-même, en largeur, à télécharger depuis l'en-tête. Le document se
   choisit comme on ouvre « Demander un document » : un bloc, son intitulé,
   et à sa droite la liste déroulante. Tout ce que la DCH saisit tient dans un
   seul bloc, « Préremplissage », en sections selon le document, et le
   document ne se génère qu'à « Valider » ; le bloc se replie alors, et
   « Modifier » le rouvre (ADR-0121). Un document qui demande ce que le
   dossier ne porte pas le fait saisir : le salaire de l'attestation de revenu
   (ADR-0087), la catégorie du poste du certificat de travail (ADR-0091),
   les dates de l'attestation de congé (ADR-0092), le jour du départ à la
   retraite (ADR-0093), la disponibilité et la reprise de l'attestation de
   reprise après disponibilité (ADR-0104), le jour du congé de maternité ou de
   la reprise de service (ADR-0105). Les contrats, de stage et de travail, se font sans
   agent : la personne n'est pas encore dans l'application, la DCH la
   renseigne (ADR-0094, ADR-0098) ; les décisions de disponibilité, la
   domiciliation bancaire et la déclaration de mouvement du travailleur
   aussi, la DCH renseignant tout ce qu'elles impriment (ADR-0100, ADR-0102,
   ADR-0106).

   L'aperçu EST le PDF, peint par pdf.js : un modèle de l'APIX se vérifie sur
   ce qui sortira, pas sur une imitation à l'écran.
*/

const nomDe = (a: EmployeeListItem) => `${a.givenName} ${a.familyName}`;

/** Ce que la DCH saisit pour un document ; une date, au format AAAA-MM-JJ. */
type Valeurs = {
  salaire: number | null;
  categorie: string;
  debut: string;
  fin: string;
  depart: string;
  reprise: string;
};
/** Les valeurs saisies, et l'agent pour qui : elles ne passent pas d'un agent à l'autre. */
type Saisies = Valeurs & { agentId: string };
const VIDES: Valeurs = {
  salaire: null,
  categorie: '',
  debut: '',
  fin: '',
  depart: '',
  reprise: '',
};

/** L'intitulé de la section des saisies, document par document. */
const SECTION_DES_SAISIES: Partial<Record<DocumentGenere, string>> = {
  attestation_conge: 'Renseigner le congé',
  attestation_cessation: 'Renseigner le congé de maternité',
  attestation_reprise_service: 'Renseigner la reprise de service',
  attestation_reprise_disponibilite: 'Renseigner la disponibilité et la reprise',
  attestation_depart_retraite: 'Renseigner le départ à la retraite',
  attestation_revenu: 'Renseigner le salaire',
  certificat_travail: 'Renseigner le poste',
};

/** Le nom de chaque champ de date, au-dessus du champ et à voix haute. */
const LIBELLES_DES_DATES = {
  debut: 'Premier jour du congé',
  fin: 'Dernier jour du congé',
  depart: 'Date de départ à la retraite',
  reprise: 'Jour de la reprise de service',
} as const;

/**
 * Les dates qu'un document nomme autrement : le début et la fin sont ceux de
 * la disponibilité pour l'attestation de reprise après disponibilité ; le
 * début, celui du congé de maternité pour la cessation de paiement.
 */
const DATES_DU_DOCUMENT: Partial<
  Record<DocumentGenere, Partial<Record<'debut' | 'fin', { libelle: string }>>>
> = {
  attestation_cessation: {
    debut: { libelle: 'Premier jour du congé de maternité' },
  },
  attestation_reprise_disponibilite: {
    debut: { libelle: 'Premier jour de la disponibilité' },
    fin: { libelle: 'Dernier jour de la disponibilité' },
  },
};
const libelleDe = (doc: DocumentGenere, s: keyof typeof LIBELLES_DES_DATES) =>
  (s === 'debut' || s === 'fin' ? DATES_DU_DOCUMENT[doc]?.[s]?.libelle : undefined) ??
  LIBELLES_DES_DATES[s];

/** Ce qui part à l'API : la catégorie en capitales, comme le document l'imprime. */
const valeurDe = (v: Valeurs, s: Saisie) =>
  s === 'salaire'
    ? v.salaire
    : s === 'categorie'
      ? v.categorie.trim().toLocaleUpperCase('fr-FR')
      : v[s];
const remplie = (v: Valeurs, s: Saisie) => {
  const valeur = valeurDe(v, s);
  return valeur !== null && valeur !== '';
};

/** Ce qui a été validé : pour qui le document se génère, et ce qui part à l'API. */
interface Validation {
  cible: Cible;
  saisies: Record<string, unknown>;
}

export default function GenererDesDocumentsPage() {
  const me = useMe();
  const id = useId();
  // Qui dirige la DCH génère tout ; un membre, les contrats qu'on lui délègue (ADR-0114).
  const generables = DANS_L_ORDRE.filter((d) => peutGenerer(me.data, d));
  const [choisi, setChoisi] = useState<DocumentGenere | null>(null);
  const [agent, setAgent] = useState<EmployeeListItem | null>(null);
  const [saisies, setSaisies] = useState<Saisies | null>(null);
  const [stagiaire, setStagiaire] = useState<SaisieDuStagiaire>(STAGIAIRE_VIDE);
  const [contrat, setContrat] = useState<SaisieDuContrat>(CONTRAT_VIDE);
  const [disponibilite, setDisponibilite] = useState<SaisieDeLaDecision>(DECISION_VIDE);
  const [domiciliation, setDomiciliation] = useState<SaisieDeLaDomiciliation>(DOMICILIATION_VIDE);
  const [declaration, setDeclaration] = useState<SaisieDeLaDeclaration>(DECLARATION_VIDE);
  // Ce que « Valider » a retenu ; null tant que le préremplissage est ouvert.
  const [validation, setValidation] = useState<Validation | null>(null);

  const sansLAgent = choisi !== null && sansAgent(choisi);
  const demandees = choisi ? saisiesDe(choisi) : [];
  const courantes: Valeurs = saisies && saisies.agentId === agent?.id ? saisies : VIDES;
  const saisir = (valeur: Partial<Valeurs>) => {
    if (agent) setSaisies({ ...courantes, ...valeur, agentId: agent.id });
  };
  const deTravail = choisi === 'contrat_cdd' || choisi === 'contrat_cdi' ? choisi : null;
  const deDisponibilite =
    choisi === 'decision_disponibilite' || choisi === 'decision_renouvellement_disponibilite'
      ? choisi
      : null;
  // La fiche du document sans agent, telle qu'elle partira à l'API.
  const ficheSansAgent = deTravail
    ? versLaFicheDuContrat(contrat, deTravail)
    : deDisponibilite
      ? versLaFicheDeLaDecision(disponibilite, deDisponibilite)
      : choisi === 'domiciliation_bancaire'
        ? versLaFicheDeLaDomiciliation(domiciliation)
        : choisi === 'declaration_mouvement'
          ? versLaFicheDeLaDeclaration(declaration)
          : versLaFiche(stagiaire);
  const fiche = deTravail
    ? ficheDuContratSchema(deTravail).safeParse(ficheSansAgent)
    : deDisponibilite
      ? ficheDeLaDecisionSchema(deDisponibilite).safeParse(ficheSansAgent)
      : choisi === 'domiciliation_bancaire'
        ? ficheDomiciliationSchema.safeParse(ficheSansAgent)
        : choisi === 'declaration_mouvement'
          ? ficheDeclarationMouvementSchema.safeParse(ficheSansAgent)
          : ficheStagiaireSchema.safeParse(ficheSansAgent);
  // « Valider » s'ouvre quand tout est saisi : la fiche complète, ou l'agent
  // et chacune de ses saisies.
  const pret =
    choisi !== null &&
    (sansLAgent ? fiche.success : agent !== null && demandees.every((s) => remplie(courantes, s)));

  const valider = () => {
    if (!choisi || !pret) return;
    if (sansLAgent) {
      if (!fiche.success) return;
      setValidation({
        cible: {
          cle: 'fiche',
          chemin: `/documents/generer/${choisi}`,
          fichier: nomDuDocumentGenere(
            choisi,
            `${fiche.data.nom.toUpperCase()}-${fiche.data.prenom}`,
          ),
          titre: `${REQUESTABLE_DOC_LABELS[choisi]} : ${fiche.data.prenom} ${fiche.data.nom}`,
        },
        saisies: fiche.data,
      });
    } else if (agent) {
      setValidation({
        cible: {
          cle: agent.id,
          chemin: `/employees/${agent.id}/generer/${choisi}`,
          fichier: nomDuDocumentGenere(choisi, agent.employeeNumber),
          titre: `${REQUESTABLE_DOC_LABELS[choisi]} : ${nomDe(agent)}`,
        },
        saisies: Object.fromEntries(demandees.map((s) => [s, valeurDe(courantes, s)])),
      });
    }
    // Le bloc se replie : on remonte, le document vient sous les deux blocs.
    document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Page>
      <Etape titre="Sélectionner le document à générer">
        <ListeDesDocuments
          libelle="Document à générer"
          invite="Choisir un document"
          documents={generables}
          choisis={choisi ? [choisi] : []}
          mention={(d) => (estGenere(d) ? null : 'À venir')}
          onChoisir={(d) => {
            if (!estGenere(d)) return;
            setChoisi(d);
            // Un autre document se valide à son tour.
            setValidation(null);
          }}
        />
      </Etape>
      {choisi ? (
        <Preremplissage
          valide={validation !== null}
          pret={pret}
          onValider={valider}
          onModifier={() => setValidation(null)}
        >
          {choisi === 'contrat_stage' ? (
            <FicheDuStagiaire valeur={stagiaire} onChange={setStagiaire} />
          ) : null}
          {deTravail ? (
            <FicheDuContratDeTravail doc={deTravail} valeur={contrat} onChange={setContrat} />
          ) : null}
          {choisi === 'domiciliation_bancaire' ? (
            <FicheDeLaDomiciliation valeur={domiciliation} onChange={setDomiciliation} />
          ) : null}
          {choisi === 'declaration_mouvement' ? (
            <FicheDeLaDeclaration valeur={declaration} onChange={setDeclaration} />
          ) : null}
          {deDisponibilite ? (
            <FicheDeLaDecision
              doc={deDisponibilite}
              valeur={disponibilite}
              onChange={setDisponibilite}
            />
          ) : null}
          {sansLAgent ? null : (
            <Groupe titre="Sélectionner l’agent">
              <Field label="Agent" htmlFor={`${id}-agent`} required>
                <ChoixDeLAgent id={`${id}-agent`} agent={agent} onChoisir={setAgent} />
              </Field>
            </Groupe>
          )}
          {!sansLAgent && agent && demandees.length > 0 ? (
            <Groupe titre={SECTION_DES_SAISIES[choisi] ?? 'Renseigner le document'}>
              {demandees.map((s, i) => (
                <Field
                  key={s}
                  label={
                    s === 'salaire'
                      ? 'Salaire net mensuel'
                      : s === 'categorie'
                        ? 'Catégorie du poste'
                        : libelleDe(choisi, s)
                  }
                  htmlFor={`${id}-${s}`}
                  required
                >
                  {s === 'salaire' ? (
                    <ChampDuSalaire
                      key={agent.id}
                      id={`${id}-${s}`}
                      premier={i === 0}
                      salaire={courantes.salaire}
                      onSaisir={(salaire) => saisir({ salaire })}
                    />
                  ) : s === 'categorie' ? (
                    <ChampDeLaCategorie
                      key={agent.id}
                      id={`${id}-${s}`}
                      premier={i === 0}
                      categorie={courantes.categorie}
                      onSaisir={(categorie) => saisir({ categorie })}
                    />
                  ) : (
                    <ChampDeDate
                      key={agent.id}
                      id={`${id}-${s}`}
                      premier={i === 0}
                      libelle={libelleDe(choisi, s)}
                      date={courantes[s]}
                      // La fin et la reprise ne se choisissent pas avant le début.
                      min={
                        s === 'fin' || s === 'reprise' ? courantes.debut || undefined : undefined
                      }
                      onSaisir={(date) => saisir({ [s]: date })}
                    />
                  )}
                </Field>
              ))}
            </Groupe>
          ) : null}
        </Preremplissage>
      ) : null}
      {choisi && validation ? (
        <Apercu choisi={choisi} cible={validation.cible} saisies={validation.saisies} />
      ) : null}
    </Page>
  );
}

/**
 * L'agent : nom ou matricule, dossiers en activité ou non (un certificat de
 * travail se délivre au départ). Le champ montre le nom retenu ; y écrire
 * en cherche un autre, et le quitter sans choisir garde le premier. Jamais
 * soi : son propre dossier ne se génère pas d'ici.
 */
function ChoixDeLAgent({
  id: idDuChamp,
  agent,
  onChoisir,
}: {
  /** L'identifiant du champ, que son intitulé désigne. */
  id: string;
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
        id={idDuChamp}
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
            className={cn(DEFILEMENT, 'max-h-[min(18rem,calc(100dvh_-_12rem))]')}
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
                    'flex cursor-pointer items-center gap-3 rounded-controle-sm px-2.5 py-2 transition-colors duration-150',
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
 * Le salaire net mensuel, en francs CFA et en chiffres, les milliers séparés
 * à la frappe. La première saisie s'ouvre prête à écrire, dès le choix de
 * l'agent.
 */
function ChampDuSalaire({
  id,
  premier,
  salaire,
  onSaisir,
}: {
  id: string;
  premier: boolean;
  salaire: number | null;
  onSaisir: (salaire: number | null) => void;
}) {
  const montant = champDuMontant(salaire, onSaisir);
  return (
    <div className="relative">
      <input
        {...montant}
        id={id}
        autoFocus={premier}
        autoComplete="off"
        aria-label="Salaire net mensuel, en francs CFA"
        placeholder="Montant en chiffres"
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
 * La catégorie du poste dans la convention collective : « 7B ». Ses lettres
 * s'affichent en capitales à la frappe, comme le document les imprime.
 */
function ChampDeLaCategorie({
  id,
  premier,
  categorie,
  onSaisir,
}: {
  id: string;
  premier: boolean;
  categorie: string;
  onSaisir: (categorie: string) => void;
}) {
  return (
    <input
      id={id}
      autoFocus={premier}
      autoComplete="off"
      aria-label="Catégorie du poste"
      placeholder="Catégorie"
      maxLength={CATEGORIE_MAX}
      value={categorie}
      onChange={(e) => onSaisir(e.target.value)}
      className={cn(
        CHAMP,
        'border-line px-3 font-medium text-ink-strong uppercase placeholder:font-normal placeholder:text-ink-muted placeholder:normal-case hover:border-ink-muted/40 focus:border-primary',
      )}
    />
  );
}

/** Une date saisie, au calendrier du navigateur : celles du congé, le départ à la retraite. */
function ChampDeDate({
  id,
  premier,
  libelle,
  date,
  min,
  onSaisir,
}: {
  id: string;
  premier: boolean;
  libelle: string;
  date: string;
  min?: string;
  onSaisir: (date: string) => void;
}) {
  return (
    <input
      type="date"
      id={id}
      autoFocus={premier}
      aria-label={libelle}
      value={date}
      min={min}
      onChange={(e) => onSaisir(e.target.value)}
      className={cn(
        CHAMP,
        'border-line px-3 font-medium text-ink-strong tabular-nums hover:border-ink-muted/40 focus:border-primary',
      )}
    />
  );
}

/** Pour qui le document se génère : un agent, ou la personne que la DCH renseigne. */
interface Cible {
  /** L'agent, ou « fiche » pour un document sans agent : à chaque personne son aperçu. */
  cle: string;
  /** La route de l'API qui rend le PDF. */
  chemin: string;
  /** Le nom du fichier enregistré. */
  fichier: string;
  /** Le titre de l'aperçu. */
  titre: string;
}

/**
 * Le document, tel qu'il sortira, une fois le préremplissage validé : en
 * largeur, comme le procès-verbal d'apix-e-voting, sans rien au-dessus.
 * « Télécharger » se pose dans l'en-tête dès que le PDF est prêt, et s'en
 * retire tant que celui d'une nouvelle validation n'est pas arrivé : on
 * n'enregistre pas l'ancien document.
 */
function Apercu({
  choisi,
  cible,
  saisies,
}: {
  choisi: DocumentGenere;
  cible: Cible;
  saisies: Record<string, unknown>;
}) {
  const pdf = useQuery({
    queryKey: ['document-genere', choisi, cible.cle, saisies],
    // En POST : ce qui est saisi, un salaire par exemple, reste hors de l'adresse.
    queryFn: ({ signal }) => lireFichier(cible.chemin, { signal, corps: saisies }),
    retry: false,
    // Une autre saisie pour le même document et la même personne : l'ancien
    // PDF reste à l'écran le temps du nouveau, la page ne clignote pas.
    placeholderData: (precedent, requete) =>
      requete?.queryKey[1] === choisi && requete.queryKey[2] === cible.cle ? precedent : undefined,
  });
  const aJour = !pdf.isPlaceholderData;

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
      <div className="grid aspect-[595/842] place-items-center rounded-bloc bg-white shadow-xs ring-1 ring-card-line">
        <span className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      </div>
    );
  }
  return (
    <>
      {aJour ? (
        <ActionDeLEntete
          icon="download"
          label="Télécharger"
          onClick={() =>
            enregistrerFichier(new Blob([contenu], { type: 'application/pdf' }), cible.fichier)
          }
        />
      ) : null}
      <div className={cn('transition-opacity duration-200', !aJour && 'opacity-55')}>
        <PdfEnLargeur data={contenu} titre={cible.titre} />
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
