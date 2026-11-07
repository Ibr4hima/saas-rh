'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type {
  AgentDeLaCible,
  DocumentAChoixDAgent,
  DocumentAvecAgent,
  DocumentGenere,
  DocumentHorsDossier,
  DocumentRequestView,
  DossierPourLaFiche,
  FicheDepuisLeDossier,
  Saisie,
  StageAuDossier,
} from '@teranga/contracts';
import {
  CATEGORIE_MAX,
  CIBLES_DES_CHOIX,
  CIBLES_DES_DOCUMENTS,
  dateDeLaDemande,
  datesEnfreintes,
  depuisLeDossier,
  estGenere,
  finDeDisponibiliteAuPlusTard,
  ficheDeclarationMouvementSchema,
  ficheDeLaDecisionSchema,
  ficheDomiciliationSchema,
  ficheDuContratSchema,
  ficheHorsDossierSchema,
  ficheStagiaireSchema,
  horsCible,
  horsDossier,
  nomDuDocumentGenere,
  peutGenerer,
  plusJours,
  REQUESTABLE_DOC_LABELS,
  saisiesPour,
  sansAgent,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  cn,
  DateInput,
  EmptyState,
  Field,
  Select,
} from '@teranga/ui';
import { Page } from './gabarit';
import { Icon } from './icons';
import { VoirLaLettre } from './lettre-de-demande';
import {
  CHAMP,
  DANS_L_ORDRE,
  DEFILEMENT,
  Etape,
  ListeDesDocuments,
  MENU,
} from './liste-des-documents';
import { PdfEnLargeur } from './pdf-viewer';
import { ActionDeLEntete } from './entete';
import {
  CONTRAT_VIDE,
  FicheDuContratDeTravail,
  versLaFicheDuContrat,
  type SaisieDuContrat,
} from './fiche-contrat-travail';
import {
  DECLARATION_VIDE,
  FicheDeLaDeclaration,
  versLaFicheDeLaDeclaration,
  type SaisieDeLaDeclaration,
} from './fiche-declaration-mouvement';
import {
  DECISION_VIDE,
  decisionDepuisLeDossier,
  FicheDeLaDecision,
  usePreremplissageDeLaDecision,
  versLaFicheDeLaDecision,
  type SaisieDeLaDecision,
} from './fiche-decision-disponibilite';
import {
  DOMICILIATION_VIDE,
  domiciliationDepuisLeDossier,
  FicheDeLaDomiciliation,
  versLaFicheDeLaDomiciliation,
  type SaisieDeLaDomiciliation,
} from './fiche-domiciliation';
import {
  FicheHorsDossier,
  HORS_DOSSIER_VIDE,
  versLaFicheHorsDossier,
  type SaisieHorsDossier,
} from './fiche-hors-dossier';
import {
  FicheDuStagiaire,
  STAGIAIRE_VIDE,
  versLaFiche,
  type SaisieDuStagiaire,
} from './fiche-stagiaire';
import { CADRE, Choix, Groupe, OuiNon, Preremplissage } from './saisie-de-fiche';
import { api, ApiError } from '../lib/api';
import { enregistrerFichier, lireFichier } from '../lib/fichiers';
import { formatDate, useMe } from '../lib/hooks';
import { champDuMontant } from '../lib/montant';

/*
   « Générer des documents » (ADR-0085), en trois temps qui se découvrent
   l'un après l'autre : le document, le préremplissage, puis le document
   lui-même, en largeur, à télécharger depuis l'en-tête. Le document se
   choisit comme on ouvre « Demander un document » : un bloc, son intitulé,
   et à sa droite la liste déroulante. Tout ce que la DCH saisit tient dans un
   seul bloc, « Préremplissage », en sections selon le document, et le
   document ne se génère qu'à « Valider » ; le bloc se replie alors, et
   « Modifier » le rouvre (ADR-0121). L'agent et ce que son document
   demande se saisissent sur une même ligne (ADR-0168). Un document qui
   demande ce que le dossier ne porte pas le fait saisir : le salaire de
   l'attestation de revenu (ADR-0087), la catégorie du poste du certificat de travail (ADR-0091),
   les dates de l'attestation de congé (ADR-0092), le jour du départ à la
   retraite (ADR-0093), la disponibilité et la reprise de l'attestation de
   reprise après disponibilité (ADR-0104), le jour du congé de maternité ou de
   la reprise de service (ADR-0105), le stage que cite l'attestation de stage
   quand le dossier en compte plusieurs (ADR-0132). Les contrats, de stage et
   de travail, se font sans
   agent : la personne n'est pas encore dans l'application, la DCH la
   renseigne (ADR-0094, ADR-0098) ; les décisions de disponibilité, la
   domiciliation bancaire et la déclaration de mouvement du travailleur
   aussi, la DCH renseignant tout ce qu'elles impriment (ADR-0100, ADR-0102,
   ADR-0106). Le certificat de travail et l'attestation de stage demandent
   d'abord si la personne a un dossier dans l'application : sinon, la DCH
   renseigne une fiche (ADR-0176). Le certificat d'un agent encore en poste
   fait saisir son dernier jour de travail.

   L'aperçu EST le PDF, peint par pdf.js : un modèle de l'APIX se vérifie sur
   ce qui sortira, pas sur une imitation à l'écran.
*/

const nomDe = (a: AgentDeLaCible) => `${a.givenName} ${a.familyName}`;

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
  certificat_travail: 'Renseigner l’emploi',
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
 * début, celui du congé de maternité pour la cessation de paiement ; la fin,
 * le dernier jour de travail d'un agent encore en poste pour le certificat de
 * travail (ADR-0176).
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
  certificat_travail: {
    fin: { libelle: 'Dernier jour de travail' },
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

/** Ce que demandent d'abord le certificat de travail et l'attestation de stage (ADR-0176). */
const QUESTION_DU_DOSSIER = 'Existe-t-il un dossier de la personne dans l’application ?';

/** « 1er mars 2012 » : un jour d'un stage. */
const jourDuStage = (iso: string) => formatDate(iso).replace(/^1 /, '1er ');

/** « Du 1er mars 2012 au 31 août 2012 · Stagiaire juriste » : un stage du dossier. */
const periodeDuStage = (s: StageAuDossier) =>
  (s.fin
    ? `Du ${jourDuStage(s.debut)} au ${jourDuStage(s.fin)}`
    : `Depuis le ${jourDuStage(s.debut)}`) + (s.poste ? ` · ${s.poste}` : '');

/** Ce qui a été validé : pour qui le document se génère, et ce qui part à l'API. */
interface Validation {
  cible: Cible;
  saisies: Record<string, unknown>;
}

/**
 * « Générer des documents » : la page de la DCH (ADR-0085), et, au titre
 * d'une demande, la page du document d'une demande de mise en disponibilité,
 * de renouvellement ou de domiciliation (ADR-0189). Avec une demande, le
 * document et l'agent viennent de la demande, la fiche se préremplit du
 * dossier et de la date de la demande, et la lettre se lit à côté.
 */
export function GenererDesDocuments({ demande }: { demande?: DocumentRequestView }) {
  const me = useMe();
  const id = useId();
  // Au titre d'une demande, rien que son document et son agent (ADR-0189).
  const demandeId = demande?.id;
  const agentDeLaDemande = demande?.employeeId;
  const premierDemande = demande?.docTypes[0];
  const docDeLaDemande =
    premierDemande !== undefined && depuisLeDossier(premierDemande) ? premierDemande : null;
  const demandeLe = demande ? dateDeLaDemande(demande) : null;
  // Qui dirige la DCH génère tout ; un membre, les contrats qu'on lui délègue (ADR-0114).
  const generables = DANS_L_ORDRE.filter((d) => peutGenerer(me.data, d));
  const [choisi, setChoisi] = useState<DocumentGenere | null>(docDeLaDemande);
  const [agent, setAgent] = useState<AgentDeLaCible | null>(null);
  const [saisies, setSaisies] = useState<Saisies | null>(null);
  // Le stage que l'attestation cite, pour un agent (ADR-0132).
  const [stage, setStage] = useState<{ agentId: string; debut: string } | null>(null);
  const [stagiaire, setStagiaire] = useState<SaisieDuStagiaire>(STAGIAIRE_VIDE);
  const [contrat, setContrat] = useState<SaisieDuContrat>(CONTRAT_VIDE);
  const [disponibilite, setDisponibilite] = useState<SaisieDeLaDecision>(DECISION_VIDE);
  const [domiciliation, setDomiciliation] = useState<SaisieDeLaDomiciliation>(DOMICILIATION_VIDE);
  const [declaration, setDeclaration] = useState<SaisieDeLaDeclaration>(DECLARATION_VIDE);
  // Le certificat de travail ou l'attestation de stage d'une personne sans
  // dossier : sa fiche, que les deux documents partagent (ADR-0176).
  const [sansDossier, setSansDossier] = useState(false);
  const [personneHorsDossier, setPersonneHorsDossier] =
    useState<SaisieHorsDossier>(HORS_DOSSIER_VIDE);
  // Ce que « Valider » a retenu ; null tant que le préremplissage est ouvert.
  const [validation, setValidation] = useState<Validation | null>(null);
  // L'agent choisi pour une fiche que son dossier préremplit (ADR-0174) : pour
  // la domiciliation, et pour les décisions, qui partagent leur fiche.
  const [agentDeLaDomiciliation, setAgentDeLaDomiciliation] = useState<AgentDeLaCible | null>(null);
  const [agentDeLaDecision, setAgentDeLaDecision] = useState<AgentDeLaCible | null>(null);
  const [erreurDuDossier, setErreurDuDossier] = useState<string | null>(null);
  // Le dernier agent demandé : une réponse en retard ne remplit pas la fiche d'un autre.
  const dossierAttendu = useRef<string | null>(null);
  // Au titre d'une demande, la fiche se remplit à l'ouverture : le dossier de
  // l'agent, puis la date de la demande (ADR-0189). Une seule fois : ce que
  // la personne corrige ensuite reste.
  const [dossierLu, setDossierLu] = useState(false);
  useEffect(() => {
    if (!demandeId || !agentDeLaDemande || !docDeLaDemande || !demandeLe) return;
    let abandonne = false;
    api<DossierPourLaFiche>(
      `/documents/generer/${docDeLaDemande}/agents/${agentDeLaDemande}/fiche?demande=${demandeId}`,
    ).then(
      (d) => {
        if (abandonne) return;
        if (docDeLaDemande === 'domiciliation_bancaire') {
          setDomiciliation((s) => ({ ...domiciliationDepuisLeDossier(s, d), demandeLe }));
        } else {
          setDisponibilite((s) => ({ ...decisionDepuisLeDossier(s, d), demandeLe }));
        }
        setDossierLu(true);
      },
      (e: unknown) => {
        if (abandonne) return;
        setErreurDuDossier(
          e instanceof ApiError ? e.message : 'Le dossier de l’agent n’a pas pu être lu',
        );
      },
    );
    return () => {
      abandonne = true;
    };
  }, [demandeId, agentDeLaDemande, docDeLaDemande, demandeLe]);

  const sansLAgent = choisi !== null && sansAgent(choisi);
  const deHorsDossier: DocumentHorsDossier | null =
    choisi !== null && horsDossier(choisi) ? choisi : null;
  // La personne n'a pas de dossier : le document se génère de sa fiche.
  const surFiche = deHorsDossier !== null && sansDossier;
  const avecAgent: DocumentAvecAgent | null =
    choisi !== null && !sansAgent(choisi) && !surFiche ? choisi : null;
  // Le certificat d'un agent encore en poste fait saisir son dernier jour.
  const demandees = choisi ? saisiesPour(choisi, agent?.situation.enActivite ?? false) : [];
  const courantes: Valeurs = saisies && saisies.agentId === agent?.id ? saisies : VIDES;
  const saisir = (valeur: Partial<Valeurs>) => {
    if (agent) setSaisies({ ...courantes, ...valeur, agentId: agent.id });
  };
  const deTravail = choisi === 'contrat_cdd' || choisi === 'contrat_cdi' ? choisi : null;
  const deDisponibilite =
    choisi === 'decision_disponibilite' || choisi === 'decision_renouvellement_disponibilite'
      ? choisi
      : null;
  usePreremplissageDeLaDecision(deDisponibilite, setDisponibilite, demandeId);
  const deLaFiche = choisi !== null && depuisLeDossier(choisi) ? choisi : null;
  const agentDeLaFiche =
    deLaFiche === 'domiciliation_bancaire'
      ? agentDeLaDomiciliation
      : deLaFiche
        ? agentDeLaDecision
        : null;
  /**
   * L'agent choisi remplit la fiche de son dossier. Pour un autre agent que
   * le précédent, la fiche repart de zéro : sa demande n'est pas la même ;
   * les sessions du conseil d'administration, de l'organisation, restent.
   */
  const choisirPourLaFiche = async (doc: FicheDepuisLeDossier, a: AgentDeLaCible) => {
    const domiciliationChoisie = doc === 'domiciliation_bancaire';
    const precedent = domiciliationChoisie ? agentDeLaDomiciliation : agentDeLaDecision;
    const autre = precedent !== null && precedent.id !== a.id;
    (domiciliationChoisie ? setAgentDeLaDomiciliation : setAgentDeLaDecision)(a);
    setErreurDuDossier(null);
    dossierAttendu.current = a.id;
    try {
      const d = await api<DossierPourLaFiche>(`/documents/generer/${doc}/agents/${a.id}/fiche`);
      if (dossierAttendu.current !== a.id) return;
      if (domiciliationChoisie) {
        setDomiciliation((s) => domiciliationDepuisLeDossier(autre ? DOMICILIATION_VIDE : s, d));
      } else {
        setDisponibilite((s) =>
          decisionDepuisLeDossier(
            autre
              ? {
                  ...DECISION_VIDE,
                  pvDirectionGeneraleLe: s.pvDirectionGeneraleLe,
                  pvDirectionGeneraleAdjointeLe: s.pvDirectionGeneraleAdjointeLe,
                }
              : s,
            d,
          ),
        );
      }
    } catch (e) {
      if (dossierAttendu.current !== a.id) return;
      setErreurDuDossier(
        e instanceof ApiError ? e.message : 'Le dossier de l’agent n’a pas pu être lu',
      );
    }
  };
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
  const ficheDeLaPersonne = deHorsDossier
    ? ficheHorsDossierSchema(deHorsDossier).safeParse(
        versLaFicheHorsDossier(personneHorsDossier, deHorsDossier),
      )
    : null;
  const fiche = deTravail
    ? ficheDuContratSchema(deTravail).safeParse(ficheSansAgent)
    : deDisponibilite
      ? ficheDeLaDecisionSchema(deDisponibilite).safeParse(ficheSansAgent)
      : choisi === 'domiciliation_bancaire'
        ? ficheDomiciliationSchema.safeParse(ficheSansAgent)
        : choisi === 'declaration_mouvement'
          ? ficheDeclarationMouvementSchema.safeParse(ficheSansAgent)
          : ficheStagiaireSchema.safeParse(ficheSansAgent);
  // L'attestation de stage cite un stage du dossier : à plusieurs, la DCH
  // choisit lequel (ADR-0132).
  const stages = useQuery({
    queryKey: ['stages', agent?.id],
    queryFn: () => api<StageAuDossier[]>(`/employees/${agent?.id}/stages`),
    enabled: choisi === 'attestation_stage' && !surFiche && agent !== null,
  });
  const stagesAChoisir =
    choisi === 'attestation_stage' && !surFiche && stages.data && stages.data.length > 1
      ? stages.data
      : null;
  const stageCourant = stage && stage.agentId === agent?.id ? stage.debut : '';
  // Les dates saisies dans l'ordre (ADR-0133) : le dernier jour d'un congé
  // ou d'une disponibilité après le premier, la reprise pas avant le dernier.
  const erreursDesDates = choisi ? datesEnfreintes(choisi, courantes) : {};
  // « Valider » s'ouvre quand tout est saisi : la fiche complète, ou l'agent
  // et chacune de ses saisies, dans l'ordre, le stage compris.
  const pret =
    choisi !== null &&
    (sansLAgent
      ? fiche.success && (deLaFiche === null || (demande ? dossierLu : agentDeLaFiche !== null))
      : surFiche
        ? ficheDeLaPersonne?.success === true
        : agent !== null &&
          demandees.every((s) => remplie(courantes, s)) &&
          Object.keys(erreursDesDates).length === 0 &&
          (choisi !== 'attestation_stage' ||
            (stages.isSuccess && (!stagesAChoisir || stageCourant !== ''))));

  const valider = () => {
    if (!choisi || !pret) return;
    if (sansLAgent || surFiche) {
      // La fiche d'un document sans agent, ou d'une personne sans dossier.
      const personne =
        sansLAgent && fiche.success
          ? fiche.data
          : surFiche && ficheDeLaPersonne?.success
            ? ficheDeLaPersonne.data
            : null;
      if (!personne) return;
      setValidation({
        cible: {
          cle: 'fiche',
          chemin: `/documents/generer/${choisi}${demandeId ? `?demande=${demandeId}` : ''}`,
          fichier: nomDuDocumentGenere(choisi, `${personne.nom.toUpperCase()}-${personne.prenom}`),
          titre: `${REQUESTABLE_DOC_LABELS[choisi]} : ${personne.prenom} ${personne.nom}`,
        },
        saisies: personne,
      });
    } else if (agent) {
      setValidation({
        cible: {
          cle: agent.id,
          chemin: `/employees/${agent.id}/generer/${choisi}`,
          fichier: nomDuDocumentGenere(choisi, agent.employeeNumber),
          titre: `${REQUESTABLE_DOC_LABELS[choisi]} : ${nomDe(agent)}`,
        },
        saisies: {
          ...Object.fromEntries(demandees.map((s) => [s, valeurDe(courantes, s)])),
          ...(stagesAChoisir ? { stage: stageCourant } : {}),
        },
      });
    }
    // Le bloc se replie : on remonte, le document vient sous les deux blocs.
    document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Page>
      {demande && docDeLaDemande ? (
        <LaDemande demande={demande} doc={docDeLaDemande} erreur={erreurDuDossier} />
      ) : (
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
              // L'agent choisi reste dans la cible du nouveau document ; hors d'elle, le
              // champ se vide (ADR-0130).
              if (agent && !sansAgent(d) && horsCible(CIBLES_DES_DOCUMENTS[d], agent.situation)) {
                setAgent(null);
              }
              // Un autre document se valide à son tour.
              setValidation(null);
            }}
          />
        </Etape>
      )}
      {choisi ? (
        <Preremplissage
          valide={validation !== null}
          pret={pret}
          onValider={valider}
          onModifier={() => setValidation(null)}
        >
          {deHorsDossier ? (
            // Une personne partie avant l'application, ou un stage mené sans
            // dossier : la DCH renseigne une fiche (ADR-0176).
            <Choix titre={QUESTION_DU_DOSSIER}>
              <OuiNon
                libelle={QUESTION_DU_DOSSIER}
                oui={!sansDossier}
                onChoisir={(oui) => setSansDossier(!oui)}
              />
            </Choix>
          ) : null}
          {surFiche && deHorsDossier ? (
            <FicheHorsDossier
              doc={deHorsDossier}
              valeur={personneHorsDossier}
              onChange={setPersonneHorsDossier}
            />
          ) : null}
          {deLaFiche && !demande ? (
            // L'agent d'abord : son dossier remplit la fiche (ADR-0174). Au
            // titre d'une demande, c'est le sien, et la fiche est déjà remplie.
            <Choix titre="Sélectionner l’agent">
              <ChoixDeLAgent
                key={deLaFiche}
                id={`${id}-agent`}
                doc={deLaFiche}
                agent={agentDeLaFiche}
                onChoisir={(a) => void choisirPourLaFiche(deLaFiche, a)}
              />
              {erreurDuDossier ? (
                <p className="mt-1 text-xs text-danger">{erreurDuDossier}</p>
              ) : null}
            </Choix>
          ) : null}
          {choisi === 'contrat_stage' ? (
            <FicheDuStagiaire valeur={stagiaire} onChange={setStagiaire} />
          ) : null}
          {deTravail ? (
            <FicheDuContratDeTravail doc={deTravail} valeur={contrat} onChange={setContrat} />
          ) : null}
          {choisi === 'domiciliation_bancaire' ? (
            <FicheDeLaDomiciliation
              // Un autre agent : le RIB repart de sa propre saisie.
              key={agentDeLaDomiciliation?.id ?? 'aucun'}
              valeur={domiciliation}
              onChange={setDomiciliation}
            />
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
          {avecAgent && demandees.length === 0 ? (
            // L'agent seul : une ligne, son intitulé et le choix, comme le document.
            <Choix titre="Sélectionner l’agent">
              {/* Un autre document, une autre cible : le champ repart de l'agent retenu. */}
              <ChoixDeLAgent
                key={avecAgent}
                id={`${id}-agent`}
                doc={avecAgent}
                agent={agent}
                onChoisir={setAgent}
              />
            </Choix>
          ) : null}
          {stagesAChoisir && agent ? (
            <Choix titre="Sélectionner le stage">
              <Select
                id={`${id}-stage`}
                aria-label="Stage"
                value={stageCourant}
                onChange={(e) => setStage({ agentId: agent.id, debut: e.target.value })}
                className={CADRE}
              >
                <option value="" disabled hidden>
                  Choisir un stage
                </option>
                {stagesAChoisir.map((s) => (
                  <option key={s.debut} value={s.debut}>
                    {periodeDuStage(s)}
                  </option>
                ))}
              </Select>
            </Choix>
          ) : null}
          {avecAgent && demandees.length > 0 ? (
            // L'agent et ce que le document demande, sur une même ligne
            // (ADR-0168) : quatre colonnes pour les trois dates de la reprise
            // après disponibilité. Les saisies s'ouvrent une fois l'agent choisi.
            <Groupe
              titre={SECTION_DES_SAISIES[choisi] ?? 'Renseigner le document'}
              colonnes={demandees.length === 3 ? 4 : 3}
            >
              <Field label="Agent" htmlFor={`${id}-agent`} required>
                <ChoixDeLAgent
                  key={avecAgent}
                  id={`${id}-agent`}
                  doc={avecAgent}
                  agent={agent}
                  onChoisir={setAgent}
                />
              </Field>
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
                  error={erreursDesDates[s]}
                >
                  {s === 'salaire' ? (
                    <ChampDuSalaire
                      key={agent?.id ?? 'aucun'}
                      id={`${id}-${s}`}
                      premier={i === 0}
                      ouvert={agent !== null}
                      salaire={courantes.salaire}
                      onSaisir={(salaire) => saisir({ salaire })}
                    />
                  ) : s === 'categorie' ? (
                    <ChampDeLaCategorie
                      key={agent?.id ?? 'aucun'}
                      id={`${id}-${s}`}
                      premier={i === 0}
                      ouvert={agent !== null}
                      categorie={courantes.categorie}
                      onSaisir={(categorie) => saisir({ categorie })}
                    />
                  ) : (
                    <ChampDeDate
                      key={agent?.id ?? 'aucun'}
                      id={`${id}-${s}`}
                      premier={i === 0}
                      ouvert={agent !== null}
                      libelle={libelleDe(choisi, s)}
                      date={courantes[s]}
                      // La fin se choisit après le début, et une disponibilité
                      // dure deux ans au plus ; la reprise, pas avant la fin.
                      min={
                        s === 'fin' && courantes.debut
                          ? plusJours(courantes.debut, 1)
                          : s === 'reprise'
                            ? courantes.fin || courantes.debut || undefined
                            : undefined
                      }
                      max={
                        s === 'fin' &&
                        choisi === 'attestation_reprise_disponibilite' &&
                        courantes.debut
                          ? finDeDisponibiliteAuPlusTard(courantes.debut)
                          : undefined
                      }
                      invalide={Boolean(erreursDesDates[s])}
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
 * La demande que la page traite (ADR-0189) : le document, l'agent, le jour
 * de l'envoi, et la lettre, à lire avant de générer. Un dossier qui ne se lit
 * pas le dit ici : la fiche ne se remplira pas.
 */
function LaDemande({
  demande,
  doc,
  erreur,
}: {
  demande: DocumentRequestView;
  doc: FicheDepuisLeDossier;
  erreur: string | null;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:gap-5">
        <div className="min-w-0 flex-1">
          <CardTitle>{REQUESTABLE_DOC_LABELS[doc]}</CardTitle>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            <span className="font-semibold text-ink-strong">{demande.employeeName}</span>
            {' · '}
            <span className="font-mono text-[11.5px]">{demande.employeeNumber}</span>
            {' · '}
            <span className="whitespace-nowrap">
              Demande envoyée le {formatDate(demande.createdAt.slice(0, 10))}
            </span>
          </p>
          {erreur ? <p className="mt-1 text-xs text-danger">{erreur}</p> : null}
        </div>
        <VoirLaLettre
          demande={demande}
          className="h-9 shrink-0 gap-1.5 self-start px-3 text-[12.5px] sm:self-center"
        />
      </div>
    </Card>
  );
}

/**
 * L'agent, dans la cible du document (ADR-0130) : une
 * attestation de travail ne propose pas un stage, un certificat de travail
 * pas un dossier en activité. Un clic ouvre la liste de toute la cible, par
 * nom ; un nom ou un matricule la resserre. Le champ montre le nom retenu ;
 * y écrire en cherche un autre, et le quitter sans choisir garde le premier.
 * Jamais soi : son propre dossier ne se génère pas d'ici.
 */
function ChoixDeLAgent({
  id: idDuChamp,
  doc,
  agent,
  onChoisir,
}: {
  /** L'identifiant du champ, que son intitulé désigne. */
  id: string;
  doc: DocumentAChoixDAgent;
  agent: AgentDeLaCible | null;
  onChoisir: (a: AgentDeLaCible) => void;
}) {
  const id = useId();
  const [texte, setTexte] = useState(agent ? nomDe(agent) : '');
  const [cherche, setCherche] = useState('');
  const [ouverte, setOuverte] = useState(false);
  const [courant, setCourant] = useState(0);

  // Le nom retenu, tel que le champ le montre, ne cherche rien : la liste
  // montre toute la cible.
  useEffect(() => {
    const saisi = agent && texte === nomDe(agent) ? '' : texte.trim();
    const t = setTimeout(() => setCherche(saisi), 200);
    return () => clearTimeout(t);
  }, [texte, agent]);
  useEffect(() => {
    setCourant(0);
  }, [cherche]);
  // Au clavier, la ligne désignée reste en vue.
  useEffect(() => {
    document.getElementById(`${id}-${courant}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, courant]);

  const resultats = useQuery({
    queryKey: ['generer-agents', doc, cherche],
    queryFn: ({ signal }) =>
      api<AgentDeLaCible[]>(`/documents/generer/${doc}/agents?q=${encodeURIComponent(cherche)}`, {
        signal,
      }),
    enabled: ouverte,
  });
  const agents = resultats.data ?? [];
  const visible = ouverte;
  // À l'ouverture, la ligne de l'agent retenu est désignée, et en vue.
  useEffect(() => {
    if (!ouverte || cherche || !agent) return;
    const i = (resultats.data ?? []).findIndex((a) => a.id === agent.id);
    if (i >= 0) setCourant(i);
  }, [ouverte, cherche, agent, resultats.data]);
  // Les dossiers inactifs se signalent quand la cible les mêle aux autres.
  const mele = CIBLES_DES_CHOIX[doc].dossiers === 'tous';

  const remettre = () => setTexte(agent ? nomDe(agent) : '');
  const choisir = (a: AgentDeLaCible | undefined) => {
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
        // Un clic ouvre la liste de toute la cible, avant toute frappe. Tant
        // que le champ montre le nom retenu, y entrer en sélectionne tout le
        // nom : on écrit par-dessus pour en chercher un autre. Au clic, le
        // navigateur poserait le curseur au relâché et défairait la sélection :
        // le clic la pose lui-même.
        onFocus={(e) => {
          e.target.select();
          setOuverte(true);
        }}
        onMouseDown={(e) => {
          setOuverte(true);
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
                  {mele && a.status !== 'active' ? (
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
  ouvert,
  salaire,
  onSaisir,
}: {
  id: string;
  premier: boolean;
  /** L'agent est choisi : la saisie s'ouvre. */
  ouvert: boolean;
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
        disabled={!ouvert}
        autoComplete="off"
        aria-label="Salaire net mensuel, en francs CFA"
        placeholder="Montant en chiffres"
        className={cn(
          CHAMP,
          'border-line pr-14 pl-3 font-medium text-ink-strong tabular-nums placeholder:font-normal placeholder:text-ink-muted hover:border-ink-muted/40 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50',
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
  ouvert,
  categorie,
  onSaisir,
}: {
  id: string;
  premier: boolean;
  ouvert: boolean;
  categorie: string;
  onSaisir: (categorie: string) => void;
}) {
  return (
    <input
      id={id}
      autoFocus={premier}
      disabled={!ouvert}
      autoComplete="off"
      aria-label="Catégorie du poste"
      placeholder="Catégorie"
      maxLength={CATEGORIE_MAX}
      value={categorie}
      onChange={(e) => onSaisir(e.target.value)}
      className={cn(
        CHAMP,
        'border-line px-3 font-medium text-ink-strong uppercase placeholder:font-normal placeholder:text-ink-muted placeholder:normal-case hover:border-ink-muted/40 focus:border-primary disabled:cursor-not-allowed disabled:opacity-50',
      )}
    />
  );
}

/** Une date saisie, tapée ou choisie au calendrier : celles du congé, le départ à la retraite. */
function ChampDeDate({
  id,
  premier,
  ouvert,
  libelle,
  date,
  min,
  max,
  invalide = false,
  onSaisir,
}: {
  id: string;
  premier: boolean;
  ouvert: boolean;
  libelle: string;
  date: string;
  min?: string;
  max?: string;
  invalide?: boolean;
  onSaisir: (date: string) => void;
}) {
  return (
    <DateInput
      id={id}
      autoFocus={premier}
      disabled={!ouvert}
      aria-label={libelle}
      aria-invalid={invalide || undefined}
      value={date}
      min={min}
      max={max}
      onChange={(e) => onSaisir(e.target.value)}
      className={cn(
        CHAMP,
        'border-line px-3 font-medium text-ink-strong hover:border-ink-muted/40 focus:border-primary',
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
