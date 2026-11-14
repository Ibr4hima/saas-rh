import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  banqueDe,
  CHOIX_AUCUN,
  estSecretariatGeneral,
  LIBELLES_LIEN_DE_PARENTE,
  LIBELLES_PERSONNEL,
  LIBELLES_REGION,
  nomAbrege,
  peut,
  posteDAdjoint,
  posteDeResponsable,
  ribGroupe,
  type BilanDuVidage,
  type CandidatImport,
  type AgentImport,
  type ChoixImport,
  type CreateEmployeeInput,
  type LigneImport,
  type NoeudImport,
  type OrgUnitType,
  type RapportImportEmployes,
  type RattachementImport,
  type ResponsableImport,
  type SessionUser,
  type UpdateEmployeeInput,
  type VueRemuneration,
} from '@teranga/contracts';
import { EncryptionService } from '../../common/encryption.service';
import { problem, ProblemException } from '../../common/problem';
import { lirePremiereFeuille, XlsxIllisible, type CelluleXlsx } from '../../common/xlsx';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { reconcilierLeCircuit } from '../time/visas';
import {
  directeurGeneral,
  directionDeLUnite,
  dirigeUneDirection,
  rattacherDOffice,
  SOMMET,
  superieurAttendu,
  verrouillerLaChaine,
} from './chaine';
import { contratEchu, enStage } from './en-activite';
import {
  CHAMPS_DE_LA_REMUNERATION,
  cleDUnite,
  colonnesRemplies,
  correspondre,
  designeLaDirection,
  lireLigne,
  MONTANTS,
  nomDUnite,
  type Correspondance,
  type LigneLue,
  type NaturePoste,
} from './import-employes';
import {
  cleDeNom,
  dateLisible,
  LIBELLES_SEXE,
  montantLisible,
  nomComparable,
  nomsProches,
  ouiNon,
  rapprocher,
  squelette,
} from './import-valeurs';
import { OrgUnitsService } from './org-units.service';
import { PeopleService } from './people.service';

/* ────────────────────────────────────────────────────────────────
   L'import du fichier du personnel de la DCH (ADR-0159).

   ─── Il ne se fait jamais à l'aveugle

   Le même envoi sert deux fois. En aperçu, l'import se JOUE en entier, dans
   une transaction qu'on annule à la fin : les unités se créent, les dossiers
   s'écrivent, les responsables se désignent, les N+1 se rattachent, avec
   toutes les règles de la fiche et de l'organigramme. L'aperçu dit donc ce
   que l'import fera, refus compris. Une fois l'aperçu approuvé, le second
   envoi joue la même chose et garde tout.

   ─── Les règles décidées avec la DCH

   1. Un matricule inconnu crée la fiche ; un matricule connu la met à jour,
      et l'aperçu liste chaque changement. Une case vide n'efface rien.
   2. Seuls le matricule, le prénom, le nom et la date d'entrée bloquent une
      ligne. Ailleurs, la valeur fausse est écartée et signalée.
   3. Un matricule en double dans le fichier donne 50A, 50B : des
      matricules provisoires, que le réimport retrouve par la personne. La
      lettre suit l'ancienneté : A pour la personne entrée la première.
   4. Le poste place l'agent : « Chef de département Digitalisation » le met
      à la tête du département, créé s'il n'existe pas.
   5. Le N+1 et le responsable fonctionnel se désignent par leur nom. Un nom
      porté par deux personnes, ou qui ne se retrouve qu'à une faute près,
      se départage avant l'import.
   6. Une ligne fautive n'arrête pas les autres : chaque écriture a son point
      de reprise dans la transaction.
   7. Dans une direction qui compte des départements, un service se range
      sous l'un d'eux : celui que nomme la ligne, le seul que compte la
      direction, ou celui que la DCH choisit à l'aperçu (ADR-0178).
   8. Avant d'appliquer, la DCH voit l'organigramme que l'import laisse :
      elle affecte les agents qu'il crée à une unité de leur direction, et
      désigne le responsable des unités qui n'en ont pas (ADR-0179).
   ──────────────────────────────────────────────────────────────── */

/** Les réglages faits sur l'organigramme de l'aperçu (ADR-0179). */
interface Reglages {
  /** La clé d'une unité, les lignes des agents qu'on y affecte. */
  placements?: Record<string, number[]>;
  /** La clé d'une unité sans responsable, la personne retenue ou `aucun`. */
  responsables?: Record<string, string>;
}

/**
 * La clé d'une unité dans l'organigramme de l'aperçu : courte, pour tenir
 * dans l'adresse, et la même d'un aperçu à l'autre, alors que l'id d'une
 * unité que l'import crée change à chaque fois.
 */
const cleCourte = (cle: string) => createHash('sha256').update(cle).digest('hex').slice(0, 12);

/** Au-delà, ce n'est plus un fichier qu'on importe : c'est une migration. */
const MAX_LIGNES = 5_000;

/** Lancée au bout de l'aperçu : la transaction s'annule, le rapport reste. */
class FinDeLApercu extends Error {
  constructor(readonly rapport: RapportImportEmployes) {
    super('Aperçu');
  }
}

@Injectable()
export class ImportEmployesService {
  private readonly journal = new Logger('Import');

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(PeopleService) private readonly people: PeopleService,
    @Inject(EncryptionService) private readonly crypto: EncryptionService,
  ) {}

  /**
   * Lit le fichier et le joue. `appliquer` faux : tout est annulé, seul le
   * rapport reste. `choix` : les homonymes départagés, de la clé du choix au
   * candidat retenu. `noms` : les noms d'unités corrigés à l'aperçu, de la
   * clé de l'unité à son nom. `rattachements` : les services rangés à
   * l'aperçu, de la clé du service à celle de son département. `reglages` :
   * les agents placés et les responsables désignés sur l'organigramme de
   * l'aperçu.
   */
  async importer(
    user: SessionUser,
    fichier: Buffer,
    appliquer: boolean,
    choix: Record<string, string> = {},
    noms: Record<string, string> = {},
    rattachements: Record<string, string> = {},
    reglages: Reglages = {},
  ): Promise<RapportImportEmployes> {
    const feuille = this.lire(fichier);
    // Les intitulés sont sur la première ligne, ou plus bas sous un titre :
    // la première ligne, parmi les dix premières, qui en porte au moins trois.
    const debut = feuille.lignes
      .slice(0, 10)
      .findIndex((l) => Object.keys(correspondre(l).colonnes).length >= 3);
    const rang = Math.max(0, debut);
    const entetes = feuille.lignes[rang];
    const donnees = feuille.lignes.slice(rang + 1);
    if (!entetes) problem(422, 'import.vide', 'Le fichier ne contient aucune ligne');
    if (donnees.length > MAX_LIGNES) {
      problem(422, 'import.trop_long', `Le fichier dépasse ${MAX_LIGNES} lignes`);
    }
    const corr = correspondre(entetes);
    const vide: RapportImportEmployes = {
      feuille: feuille.nom,
      colonnesInconnues: corr.inconnues,
      colonnesManquantes: corr.manquantes,
      // La rémunération ne s'importe qu'avec l'accès aux données sensibles.
      colonnesNonImportees: peut(user, 'personnel.sensible')
        ? []
        : colonnesRemplies(corr, donnees, CHAMPS_DE_LA_REMUNERATION),
      lignes: [],
      unitesCreees: [],
      servicesRanges: [],
      designations: [],
      choix: [],
      rattachements: [],
      unitesSansResponsable: [],
      organigramme: [],
      agents: [],
      total: 0,
      aCreer: 0,
      aModifier: 0,
      inchanges: 0,
      erreurs: 0,
      sansN1: 0,
      applique: false,
    };
    // Une colonne indispensable absente : rien à dire des lignes.
    if (corr.manquantes.length > 0) return vide;

    try {
      return await this.db.withTenant(
        { tenantId: user.tenantId, userId: user.userId },
        async (tx) => {
          await verrouillerLaChaine(tx);
          const passe = new Passe(
            tx,
            user,
            this.db,
            this.people,
            this.crypto,
            choix,
            noms,
            rattachements,
            reglages,
            this.journal,
          );
          // La ligne du tableur où commencent les agents : le rapport la cite.
          const rapport = await passe.jouer(donnees, corr, vide, rang + 2);
          if (!appliquer) throw new FinDeLApercu(rapport);
          // L'organigramme a bougé : les demandes en cours vont à qui les attend désormais.
          await reconcilierLeCircuit(tx, user.tenantId);
          return { ...rapport, applique: true };
        },
      );
    } catch (err) {
      if (err instanceof FinDeLApercu) return err.rapport;
      throw err;
    }
  }

  /**
   * « Vider l'import » (ADR-0165) : les dossiers que l'import a créés, avec
   * tout ce qui s'y rattache, et les unités qu'il a créées. L'administrateur
   * seul ; sans `appliquer`, le bilan de ce qui partirait.
   */
  async vider(user: SessionUser, appliquer: boolean): Promise<BilanDuVidage> {
    if (user.role !== 'admin') {
      problem(
        403,
        'import.vidage_reserve',
        'Réservé à l’administrateur',
        'Seul l’administrateur peut vider l’import.',
      );
    }
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      if (appliquer) await verrouillerLaChaine(tx);
      const { rows } = await tx.execute<{
        dossiers: number;
        comptes: number;
        unites: number;
        gardees: number;
      }>(sql`
        WITH ${UNITES_DE_L_IMPORT}
        SELECT
          (SELECT count(*) FROM employees WHERE cree_par_l_import)::int AS dossiers,
          (SELECT count(DISTINCT p.user_id) FROM employees e
             JOIN persons p ON p.id = e.person_id
            WHERE e.cree_par_l_import AND p.user_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM user_tenant_memberships m
                               WHERE m.user_id = p.user_id AND m.role = 'admin'))::int AS comptes,
          (SELECT count(DISTINCT racine) FROM sous)::int AS unites,
          (SELECT count(*) FROM retenues)::int AS gardees`);
      const r = rows[0]!;
      const bilan: BilanDuVidage = {
        dossiers: r.dossiers,
        comptes: r.comptes,
        unites: r.unites,
        unitesGardees: r.gardees,
      };
      if (!appliquer) return bilan;

      const { rows: dossiers } = await tx.execute<{ id: string }>(
        sql`SELECT id FROM employees WHERE cree_par_l_import`,
      );
      await this.people.effacerLesDossiers(
        tx,
        user,
        dossiers.map((d) => d.id),
      );
      // Les dossiers partis, une unité ne tient plus qu'à ce qui a été saisi
      // à la main. Supprimée comme dans l'organigramme : l'historique des
      // affectations closes reste lisible.
      await tx.execute(sql`
        WITH ${UNITES_DE_L_IMPORT}
        UPDATE org_units
           SET deleted_at = now(), manager_employee_id = NULL,
               adjoint_employee_id = NULL, updated_at = now()
         WHERE id IN (SELECT racine FROM sous)
           AND id NOT IN (SELECT racine FROM retenues)`);
      await reconcilierLeCircuit(tx, user.tenantId);
      return bilan;
    });
  }

  private lire(fichier: Buffer) {
    try {
      return lirePremiereFeuille(fichier);
    } catch (err) {
      if (err instanceof XlsxIllisible) problem(422, 'import.illisible', err.message);
      throw err;
    }
  }
}

/**
 * Les unités que l'import a créées (`sous` : chacune, et ce qu'elle porte), et
 * celles qui doivent rester (`retenues`) : une unité saisie à la main dessous,
 * l'affectation en cours d'un dossier saisi à la main, une offre d'emploi
 * ouverte. Une unité retenue garde aussi celles qui la portent.
 */
const UNITES_DE_L_IMPORT = sql`
  RECURSIVE sous (racine, id) AS (
    SELECT o.id, o.id FROM org_units o
     WHERE o.cree_par_l_import AND o.deleted_at IS NULL
    UNION ALL
    SELECT s.racine, c.id FROM sous s
      JOIN org_units c ON c.parent_id = s.id AND c.deleted_at IS NULL
  ),
  retenues AS (
    SELECT DISTINCT s.racine FROM sous s JOIN org_units u ON u.id = s.id
     WHERE NOT u.cree_par_l_import
        OR EXISTS (SELECT 1 FROM assignments a JOIN employees e ON e.id = a.employee_id
                    WHERE a.org_unit_id = u.id AND NOT e.cree_par_l_import
                      AND (upper_inf(a.validity) OR upper(a.validity) > CURRENT_DATE))
        OR EXISTS (SELECT 1 FROM job_postings j
                    WHERE j.org_unit_id = u.id AND j.status <> 'closed')
  )`;

/* ───────────────────────── Ce que la base contient ───────────────────────── */

interface Dossier {
  id: string;
  matricule: string;
  provisoire: boolean;
  actif: boolean;
  enActivite: boolean;
  /** Le dossier de qui importe : on ne modifie pas son propre dossier. */
  soi: boolean;
  prenom: string;
  nom: string;
  naissance: string | null;
  /** Le numéro de la pièce, déchiffré, pour comparer. */
  cni: string | null;
  typePiece: string | null;
  personne: {
    gender: string | null;
    birthDate: string | null;
    birthPlace: string | null;
    lieuDeNaissance: string | null;
    maritalStatus: string | null;
    epouses: string[];
    nombreEnfants: number | null;
    personalEmail: string | null;
    phone: string | null;
    addressLine: string | null;
    ville: string | null;
    region: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    lienContactUrgence: string | null;
    prenomDuPere: string | null;
    prenomDeLaMere: string | null;
    nomDeLaMere: string | null;
  };
  hiredOn: string;
  entreeAuMois: boolean;
  emploi: {
    workEmail: string | null;
    workPhone: string | null;
    personnel: string | null;
    lieuDeTravail: string | null;
    projet: string | null;
    categorie: string | null;
  };
  n1: string | null;
  fonctionnel: string | null;
  affectation: { id: string; titre: string; uniteId: string | null; responsable: boolean } | null;
  nbAffectations: number;
  contrat: { type: string; fin: string | null } | null;
  nbContrats: number;
  /**
   * La rémunération de la fiche, pour comparer. Elle ne se compare qu'avec
   * l'accès aux données sensibles, et le RIB ne se déchiffre qu'alors.
   */
  remuneration: VueRemuneration;
}

/** Les montants comme la fiche les nomme, pour l'aperçu des changements. */
const LIBELLES_DES_MONTANTS: Record<(typeof MONTANTS)[number], string> = {
  salaireDeBase: 'Salaire de base',
  sursalaire: 'Sursalaire',
  primeAnciennete: 'Prime d’ancienneté',
  brutSocial: 'Brut social',
  primeTransport: 'Prime de transport',
  salaireBrut: 'Salaire brut',
  carburant: 'Carburant',
  forfaitTelephone: 'Forfait téléphone',
  indemniteSujetion: 'Indemnité de sujétion',
};

interface Unite {
  id: string;
  nom: string;
  sigle: string | null;
  type: OrgUnitType;
  parentId: string | null;
  tete: string | null;
  adjoint: string | null;
  directionId: string | null;
  sommet: boolean;
  creeParLImport: boolean;
}

/** Une unité que le fichier nomme et que l'organigramme n'a pas encore. */
interface UniteACreer {
  /** Son type, son parent et son nom tiré du fichier : la même d'un aperçu à l'autre. */
  cle: string;
  /** Le nom qu'elle prend : celui tiré du fichier, ou celui corrigé à l'aperçu. */
  nom: string;
  propose: string;
  type: 'department' | 'service';
  parent: Place;
  id: string | null;
  echec: string | null;
}

/** Une unité de l'organigramme, ou une unité que l'import crée. */
type Place = { unite: Unite } | { nouvelle: UniteACreer };

/**
 * Un service rangé directement sous sa direction, alors qu'elle peut compter
 * des départements (ADR-0178) : un service que l'import crée, ou qu'un
 * import précédent a créé.
 */
interface ServiceARanger {
  /** La clé de l'unité à créer, ou `u:<id>` pour un service de l'organigramme. */
  cle: string;
  service: Place;
  direction: Unite;
  /** Le département que nomme une ligne du fichier. */
  departement: Place | null;
  lignes: number[];
}

interface Plan {
  lue: LigneLue;
  rapport: LigneImport;
  /** null : la fiche se crée. */
  dossier: Dossier | null;
  matricule: string;
  provisoire: boolean;
  place: Place | null;
  designation: { place: 'tete' | 'adjoint'; unite: Place } | null;
  /** La personne que nomme la colonne du N+1, ou du responsable fonctionnel. */
  n1: string | null;
  fonctionnel: string | null;
  /** Ce que la mise à jour écrit sur une fiche existante. */
  patch: UpdateEmployeeInput;
  affectation: { titre?: string; unite?: Place; creer?: boolean } | null;
  creerContrat: boolean;
  employeeId: string | null;
}

/** Une personne qu'une colonne de nom peut désigner : un dossier, ou une ligne qui en crée un. */
interface Personne {
  cle: string;
  nom: string;
  detail: string;
  noms: Set<string>;
  matricules: Set<string>;
  id: () => string | null;
}

const LIBELLES_SITUATION: Record<string, string> = {
  single: 'Célibataire',
  married: 'Marié(e)',
  divorced: 'Divorcé(e)',
  widowed: 'Veuf ou veuve',
};

/**
 * Un matricule provisoire : le matricule du fichier, puis sa lettre. 50A ;
 * 50-A pour les fiches importées avant l'ADR-0181.
 */
const PROVISOIRE = /^(.+?)-?([A-Z])$/;

/** La clé d'un matricule : ses lettres et ses chiffres, sans la casse ni les séparateurs. */
function cleMatricule(t: string): string {
  return squelette(t).replace(/ /g, '');
}

const identite = (prenom: string, nom: string) => `${nomComparable(prenom)}|${nomComparable(nom)}`;

/** Le texte d'une erreur, pour le rapport : jamais la requête SQL qu'elle porte. */
function messageDErreur(err: unknown): string {
  if (err instanceof ProblemException) return err.problem.detail ?? err.problem.title;
  const e = err as { code?: string; cause?: { code?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code === '23505') return 'Cette valeur est déjà utilisée par un autre dossier';
  if (code === '23P01') return 'Deux affectations se chevaucheraient';
  if (code === '23514') return 'Une valeur ne respecte pas les règles de la fiche';
  return 'Écriture impossible';
}

/** Le nom d'une unité pour le rapport : son sigle s'il en a un. */
function nomDeLaPlace(place: Place): string {
  if ('unite' in place) return place.unite.sigle ?? place.unite.nom;
  return place.nouvelle.nom;
}

function ligneVide(numero: number): LigneImport {
  return {
    ligne: numero,
    matricule: null,
    matriculeProvisoire: false,
    nom: null,
    poste: null,
    unite: null,
    responsable: null,
    etat: 'a-creer',
    motif: null,
    colonne: null,
    corrections: [],
    changements: [],
    avertissements: [],
  };
}

/* ───────────────────────── Une passe d'import ───────────────────────── */

class Passe {
  private aujourdhui = '';
  private dossiers: Dossier[] = [];
  private unites: Unite[] = [];
  private plans: Plan[] = [];
  private lignes: LigneImport[] = [];
  private aCreer: UniteACreer[] = [];
  private personnes: Personne[] = [];
  private readonly choixDemandes = new Map<string, ChoixImport>();
  private readonly aRanger = new Map<string, ServiceARanger>();
  private readonly rattachementsDemandes: RattachementImport[] = [];
  private readonly sansResponsable: ResponsableImport[] = [];
  private noeuds: NoeudImport[] = [];
  private agentsFinaux: AgentImport[] = [];
  private readonly deplacements: { service: Unite; vers: Place; lignes: number[] }[] = [];
  private readonly unitesCreees: RapportImportEmployes['unitesCreees'] = [];
  private readonly servicesRanges: RapportImportEmployes['servicesRanges'] = [];
  private readonly designations: RapportImportEmployes['designations'] = [];
  private readonly organigramme: OrgUnitsService;

  constructor(
    private readonly tx: Tx,
    private readonly user: SessionUser,
    db: TenantDb,
    private readonly people: PeopleService,
    private readonly crypto: EncryptionService,
    private readonly choix: Record<string, string>,
    private readonly noms: Record<string, string>,
    private readonly rattachements: Record<string, string>,
    private readonly reglages: Reglages,
    private readonly journal: Logger,
  ) {
    this.organigramme = new OrgUnitsService(db);
  }

  async jouer(
    donnees: CelluleXlsx[][],
    corr: Correspondance,
    vide: RapportImportEmployes,
    premiere: number,
  ): Promise<RapportImportEmployes> {
    await this.charger();
    const sigles = new Set(this.unites.map((u) => u.sigle).filter((s): s is string => !!s));

    donnees.forEach((cellules, i) => {
      const numero = premiere + i;
      if (cellules.every((v) => v === null || v === undefined || String(v).trim() === '')) return;
      const lue = lireLigne(numero, cellules, corr, { aujourdhui: this.aujourdhui, sigles });
      if ('refus' in lue) {
        this.lignes.push({
          ...ligneVide(numero),
          matricule: lue.refus.matricule,
          nom: lue.refus.nom,
          etat: 'erreur',
          motif: lue.refus.motif,
          colonne: lue.refus.colonne,
        });
        return;
      }
      const rapport: LigneImport = {
        ...ligneVide(numero),
        matricule: lue.ok.matricule,
        nom: `${lue.ok.prenom} ${lue.ok.nom}`,
        poste: lue.ok.poste?.intitule ?? null,
        corrections: lue.ok.corrections,
        avertissements: lue.ok.avertissements,
        emailPro: lue.ok.emploi.workEmail ?? null,
      };
      this.lignes.push(rapport);
      this.plans.push({
        lue: lue.ok,
        rapport,
        dossier: null,
        matricule: lue.ok.matricule,
        provisoire: false,
        place: null,
        designation: null,
        n1: null,
        fonctionnel: null,
        patch: {},
        affectation: null,
        creerContrat: false,
        employeeId: null,
      });
    });

    this.apparier();
    this.placer();
    this.nommer();
    for (const p of this.plans) if (p.dossier && p.rapport.etat !== 'erreur') this.comparer(p);
    this.refuserCeQuiNeSeModifiePas();

    await this.creerLesUnites();
    await this.deplacerLesServices();
    // Les responsables d'abord, désignés aussitôt : les agents qui suivent
    // relèvent d'eux dès leur création, et chaque désignation n'a plus toute
    // une direction à rattacher derrière elle.
    await this.ecrireLesDossiers((p) => p.designation !== null);
    await this.designer();
    await this.ecrireLesDossiers((p) => p.designation === null);
    await this.designerALaMain();
    await this.rattacher('n1');
    await this.rattacherDOffice();
    await this.rattacher('fonctionnel');
    await this.relire();
    await this.lireLOrganigramme();

    const lignes = this.lignes.sort((a, b) => a.ligne - b.ligne);
    for (const l of lignes) {
      if (l.etat === 'a-modifier' && l.changements.length === 0) l.etat = 'inchange';
    }
    const sommet = this.unites.find((u) => u.sommet);
    return {
      ...vide,
      lignes,
      unitesCreees: this.unitesCreees,
      servicesRanges: this.servicesRanges,
      designations: this.designations,
      choix: [...this.choixDemandes.values()],
      rattachements: this.rattachementsDemandes,
      unitesSansResponsable: this.sansResponsable,
      organigramme: this.noeuds,
      agents: this.agentsFinaux,
      total: lignes.length,
      aCreer: lignes.filter((l) => l.etat === 'a-creer').length,
      aModifier: lignes.filter((l) => l.etat === 'a-modifier').length,
      inchanges: lignes.filter((l) => l.etat === 'inchange').length,
      erreurs: lignes.filter((l) => l.etat === 'erreur').length,
      // Le DG n'a pas de N+1 : il ne compte pas.
      sansN1: lignes.filter(
        (l) =>
          (l.etat === 'a-creer' || l.etat === 'a-modifier' || l.etat === 'inchange') &&
          !l.responsable &&
          l.employeeId !== sommet?.tete,
      ).length,
    };
  }

  /* ─── Ce que la base contient avant l'import ─── */

  private async charger(): Promise<void> {
    const { rows: jour } = await this.tx.execute<{ j: string }>(
      sql`SELECT CURRENT_DATE::text AS j`,
    );
    this.aujourdhui = jour[0]!.j;

    const { rows: unites } = await this.tx.execute<{
      id: string;
      name: string;
      short_name: string | null;
      unit_type: OrgUnitType;
      parent_id: string | null;
      manager_employee_id: string | null;
      adjoint_employee_id: string | null;
      direction_id: string | null;
      sommet: boolean;
      cree_par_l_import: boolean;
    }>(sql`
      SELECT o.id, o.name, o.short_name, o.unit_type, o.parent_id, o.manager_employee_id,
             o.adjoint_employee_id, ${directionDeLUnite(sql`o.id`, 'id')} AS direction_id,
             (o.id = ${SOMMET}) AS sommet, o.cree_par_l_import
        FROM org_units o WHERE o.deleted_at IS NULL`);
    this.unites = unites.map((u) => ({
      id: u.id,
      nom: u.name,
      sigle: u.short_name,
      type: u.unit_type,
      parentId: u.parent_id,
      tete: u.manager_employee_id,
      adjoint: u.adjoint_employee_id,
      directionId: u.direction_id ?? (u.unit_type === 'direction' ? u.id : null),
      sommet: Boolean(u.sommet),
      creeParLImport: Boolean(u.cree_par_l_import),
    }));

    const { rows } = await this.tx.execute<Record<string, unknown>>(sql`
      SELECT e.id, e.employee_number, e.matricule_provisoire, e.status,
             (e.status = 'active' AND NOT ${contratEchu(sql`e.id`)}) AS en_activite,
             (p.user_id IS NOT NULL AND p.user_id = ${this.user.userId}::uuid) AS soi,
             p.given_name, p.family_name, p.birth_date::text AS birth_date,
             p.national_id_encrypted, p.id_document_type, p.gender, p.birth_place,
             p.lieu_de_naissance, p.marital_status, p.epouses, p.nombre_enfants,
             p.personal_email, p.phone, p.address_line, p.ville, p.region,
             p.emergency_contact_name, p.emergency_contact_phone, p.lien_contact_urgence,
             p.prenom_du_pere, p.prenom_de_la_mere, p.nom_de_la_mere,
             e.hired_on::text AS hired_on, e.entree_au_mois, e.work_email, e.work_phone,
             e.personnel, e.lieu_de_travail, e.projet, e.categorie,
             e.manager_employee_id, e.responsable_fonctionnel_id,
             a.id AS aff_id, a.position_title, a.org_unit_id, a.responsable,
             (SELECT count(*)::int FROM assignments x WHERE x.employee_id = e.id) AS nb_aff,
             c.contract_type, c.end_date,
             (SELECT count(*)::int FROM contracts y WHERE y.employee_id = e.id) AS nb_contrats,
             rm.salaire_de_base, rm.sursalaire, rm.prime_anciennete, rm.brut_social,
             rm.prime_transport, rm.salaire_brut, rm.carburant, rm.forfait_telephone,
             rm.indemnite_sujetion, rm.autres_avantages, rm.nombre_de_parts::float8 AS nombre_de_parts,
             rm.banque, rm.rib_chiffre, rm.salaire_domicilie, rm.numero_ipres
        FROM employees e
        JOIN persons p ON p.id = e.person_id
        LEFT JOIN LATERAL (
          SELECT av.id, av.position_title, av.org_unit_id, av.responsable
            FROM assignments av
           WHERE av.employee_id = e.id AND av.validity @> CURRENT_DATE
           ORDER BY lower(av.validity) DESC LIMIT 1) a ON true
        LEFT JOIN LATERAL (
          SELECT cv.contract_type, cv.end_date::text AS end_date
            FROM contracts cv WHERE cv.employee_id = e.id
           ORDER BY cv.start_date DESC, cv.created_at DESC LIMIT 1) c ON true
        LEFT JOIN LATERAL (
          SELECT * FROM remunerations r WHERE r.employee_id = e.id LIMIT 1) rm ON true
       WHERE p.deleted_at IS NULL`);
    const sensible = peut(this.user, 'personnel.sensible');
    this.dossiers = rows.map((r) => {
      const s = (k: string) => (r[k] as string | null | undefined) ?? null;
      const n = (k: string) => (r[k] as number | null | undefined) ?? null;
      let rib: string | null = null;
      if (sensible && typeof r.rib_chiffre === 'string') {
        try {
          rib = this.crypto.decrypt(r.rib_chiffre);
        } catch {
          rib = null;
        }
      }
      let cni: string | null = null;
      if (typeof r.national_id_encrypted === 'string') {
        try {
          cni = this.crypto.decrypt(r.national_id_encrypted).replace(/[\s.\-/]/g, '');
        } catch {
          cni = null;
        }
      }
      return {
        id: r.id as string,
        matricule: r.employee_number as string,
        provisoire: Boolean(r.matricule_provisoire),
        actif: r.status === 'active',
        enActivite: Boolean(r.en_activite),
        soi: Boolean(r.soi),
        prenom: r.given_name as string,
        nom: r.family_name as string,
        naissance: s('birth_date'),
        cni,
        typePiece: s('id_document_type'),
        personne: {
          gender: s('gender'),
          birthDate: s('birth_date'),
          birthPlace: s('birth_place'),
          lieuDeNaissance: s('lieu_de_naissance'),
          maritalStatus: s('marital_status'),
          epouses: (r.epouses as string[] | null) ?? [],
          nombreEnfants: (r.nombre_enfants as number | null) ?? null,
          personalEmail: s('personal_email'),
          phone: s('phone'),
          addressLine: s('address_line'),
          ville: s('ville'),
          region: s('region'),
          emergencyContactName: s('emergency_contact_name'),
          emergencyContactPhone: s('emergency_contact_phone'),
          lienContactUrgence: s('lien_contact_urgence'),
          prenomDuPere: s('prenom_du_pere'),
          prenomDeLaMere: s('prenom_de_la_mere'),
          nomDeLaMere: s('nom_de_la_mere'),
        },
        hiredOn: r.hired_on as string,
        entreeAuMois: Boolean(r.entree_au_mois),
        emploi: {
          workEmail: s('work_email'),
          workPhone: s('work_phone'),
          personnel: s('personnel'),
          lieuDeTravail: s('lieu_de_travail'),
          projet: s('projet'),
          categorie: s('categorie'),
        },
        n1: s('manager_employee_id'),
        fonctionnel: s('responsable_fonctionnel_id'),
        affectation: r.aff_id
          ? {
              id: r.aff_id as string,
              titre: r.position_title as string,
              uniteId: s('org_unit_id'),
              responsable: Boolean(r.responsable),
            }
          : null,
        nbAffectations: Number(r.nb_aff ?? 0),
        contrat: r.contract_type ? { type: r.contract_type as string, fin: s('end_date') } : null,
        nbContrats: Number(r.nb_contrats ?? 0),
        remuneration: {
          salaireDeBase: n('salaire_de_base'),
          sursalaire: n('sursalaire'),
          primeAnciennete: n('prime_anciennete'),
          brutSocial: n('brut_social'),
          primeTransport: n('prime_transport'),
          salaireBrut: n('salaire_brut'),
          carburant: n('carburant'),
          forfaitTelephone: n('forfait_telephone'),
          indemniteSujetion: n('indemnite_sujetion'),
          autresAvantages: s('autres_avantages'),
          nombreDeParts: n('nombre_de_parts'),
          banque: s('banque') as VueRemuneration['banque'],
          rib,
          domiciliation: (r.salaire_domicilie as boolean | null | undefined) ?? null,
          numeroIpres: s('numero_ipres'),
        },
      };
    });
  }

  /* ─── Chaque ligne, sa fiche : par le matricule, sinon par la personne ─── */

  private apparier(): void {
    const parCle = new Map<string, Dossier>();
    for (const d of this.dossiers) parCle.set(cleMatricule(d.matricule), d);
    /** La même personne : la même CNI, ou les mêmes prénom, nom et date de naissance. */
    const memePersonne = (l: LigneLue, d: Dossier) =>
      Boolean(l.personne.nationalId && d.cni && l.personne.nationalId === d.cni) ||
      Boolean(
        l.personne.birthDate &&
        d.naissance === l.personne.birthDate &&
        identite(l.prenom, l.nom) === identite(d.prenom, d.nom),
      );
    const pris = new Set<string>();
    const erreur = (p: Plan, motif: string) => {
      p.rapport.etat = 'erreur';
      p.rapport.motif = motif;
      p.rapport.colonne = p.lue.colonne('matricule');
    };

    // La même personne deux fois dans le fichier : la seconde ligne s'arrête.
    const vues = new Map<string, Plan>();
    for (const p of this.plans) {
      const cles = [
        p.lue.personne.nationalId ? `cni:${p.lue.personne.nationalId}` : null,
        p.lue.personne.birthDate
          ? `id:${identite(p.lue.prenom, p.lue.nom)}|${p.lue.personne.birthDate}`
          : null,
      ].filter((c): c is string => c !== null);
      const deja = cles.map((c) => vues.get(c)).find(Boolean);
      if (deja) {
        erreur(p, `Même personne qu’à la ligne ${deja.lue.ligne}`);
        continue;
      }
      for (const c of cles) vues.set(c, p);
    }

    const groupes = new Map<string, Plan[]>();
    for (const p of this.plans) {
      if (p.rapport.etat === 'erreur') continue;
      const cle = cleMatricule(p.lue.matricule);
      groupes.set(cle, [...(groupes.get(cle) ?? []), p]);
    }
    // Les matricules déjà pris, sur la plateforme ou dans le fichier : 50A
    // peut être le vrai matricule d'une autre personne, la lettre le saute.
    const occupes = new Set([
      ...this.dossiers.map((d) => cleMatricule(d.matricule)),
      ...this.plans.map((p) => cleMatricule(p.lue.matricule)),
    ]);

    for (const [cle, groupe] of groupes) {
      if (groupe.length === 1) {
        const p = groupe[0]!;
        const d = parCle.get(cle);
        if (d) {
          // Le même matricule désigne la même personne : un nom corrigé se
          // reconnaît à la date de naissance ou à la CNI.
          const compatible =
            identite(p.lue.prenom, p.lue.nom) === identite(d.prenom, d.nom) ||
            Boolean(p.lue.personne.birthDate && p.lue.personne.birthDate === d.naissance) ||
            Boolean(p.lue.personne.nationalId && p.lue.personne.nationalId === d.cni);
          if (!compatible) {
            erreur(
              p,
              `Le matricule ${d.matricule} est celui de ${d.prenom} ${d.nom} sur la plateforme`,
            );
            continue;
          }
          p.dossier = d;
          p.matricule = d.matricule;
          pris.add(d.id);
          continue;
        }
        // Le vrai matricule d'une fiche provisoire : 50A devient 50.
        const provisoire = this.dossiers.find(
          (x) => x.provisoire && !pris.has(x.id) && memePersonne(p.lue, x),
        );
        if (provisoire) {
          p.dossier = provisoire;
          pris.add(provisoire.id);
          continue;
        }
        const autre = this.dossiers.find((x) => !pris.has(x.id) && memePersonne(p.lue, x));
        if (autre) {
          erreur(
            p,
            `${autre.prenom} ${autre.nom} a déjà un dossier, matricule ${autre.matricule} : corrigez le matricule dans le fichier ou sur la fiche`,
          );
        }
        continue;
      }

      // Un matricule en double dans le fichier : chacun retrouve sa fiche
      // provisoire, les autres reçoivent une lettre libre, dans l'ordre de
      // l'ancienneté : 50A pour la personne entrée la première (ADR-0181).
      const base = groupe[0]!.lue.matricule;
      const famille = this.dossiers.filter((d) => {
        const m = PROVISOIRE.exec(d.matricule);
        return (
          cleMatricule(d.matricule) === cle ||
          (d.provisoire && m !== null && cleMatricule(m[1]!) === cle)
        );
      });
      const lettres = new Set(
        famille
          .map((d) => (d.provisoire ? PROVISOIRE.exec(d.matricule)?.[2] : undefined))
          .filter((x): x is string => x !== undefined),
      );
      const numeros = groupe.map((p) => p.lue.ligne).join(', ');
      const sansFiche: Plan[] = [];
      for (const p of groupe) {
        // Dans la famille d'un même matricule, le nom suffit à reconnaître.
        const d = famille.find(
          (x) =>
            !pris.has(x.id) &&
            (memePersonne(p.lue, x) ||
              identite(p.lue.prenom, p.lue.nom) === identite(x.prenom, x.nom)),
        );
        if (d) {
          p.dossier = d;
          p.matricule = d.matricule;
          pris.add(d.id);
        } else {
          sansFiche.push(p);
        }
      }
      // La personne la plus ancienne d'abord ; à la même date d'entrée,
      // l'ordre du fichier.
      sansFiche.sort((a, b) => a.lue.entree.iso.localeCompare(b.lue.entree.iso));
      const libre = (lettre: string) =>
        !lettres.has(lettre) && !occupes.has(cleMatricule(`${base}${lettre}`));
      let code = 'A'.charCodeAt(0);
      for (const p of sansFiche) {
        while (!libre(String.fromCharCode(code))) code++;
        const lettre = String.fromCharCode(code);
        lettres.add(lettre);
        p.matricule = `${base}${lettre}`;
        occupes.add(cleMatricule(p.matricule));
        p.provisoire = true;
        p.rapport.avertissements.push({
          colonne: p.lue.colonne('matricule'),
          texte: `Matricule ${base} en double dans le fichier (lignes ${numeros}) : matricule provisoire ${p.matricule}, à corriger sur la fiche`,
        });
      }
    }

    for (const p of this.plans) {
      if (p.rapport.etat === 'erreur') continue;
      p.rapport.matricule = p.matricule;
      p.rapport.matriculeProvisoire = p.provisoire;
      if (p.dossier) {
        p.rapport.etat = 'a-modifier';
        p.employeeId = p.dossier.id;
        p.rapport.employeeId = p.dossier.id;
      }
    }
  }

  /* ─── L'unité de chaque agent, et les responsables que le poste désigne ─── */

  private placer(): void {
    const directions = this.unites.filter((u) => u.type === 'direction');
    const sommet = this.unites.find((u) => u.sommet) ?? null;
    const peutCreer = peut(this.user, 'organigramme');
    const sigles = new Set(directions.map((d) => d.sigle).filter((s): s is string => !!s));

    const trouverDirection = (texte: string): { unite: Unite; corrige: boolean } | null => {
      const compact = squelette(texte).replace(/ /g, '');
      const parSigle = directions.filter(
        (d) => d.sigle && squelette(d.sigle).replace(/ /g, '') === compact,
      );
      if (parSigle.length === 1) return { unite: parSigle[0]!, corrige: false };
      const r = rapprocher(
        texte,
        directions.map((d) => ({ valeur: d, cles: [d.nom] })),
        { debut: false },
      );
      return r ? { unite: r.valeur, corrige: r.corrige } : null;
    };

    /** L'unité de ce type et de ce nom sous ce parent ; sinon celle que l'import crée. */
    const trouverOuCreer = (
      type: 'department' | 'service',
      nom: string,
      parent: Place,
      direction: Unite,
      p: Plan,
    ): Place | null => {
      const cle = cleDUnite(nom);
      if (!cle) return null;
      const candidates =
        'unite' in parent
          ? this.unites.filter(
              (u) =>
                u.type === type &&
                (type === 'department'
                  ? u.parentId === parent.unite.id
                  : u.directionId === direction.id),
            )
          : [];
      const r = rapprocher(
        cle,
        candidates.map((u) => ({ valeur: u, cles: [cleDUnite(u.nom)] })),
        { debut: false },
      );
      if (r) return { unite: r.valeur };
      const nomPropre = nomDUnite(type, nom, sigles);
      if (!peutCreer) {
        p.rapport.avertissements.push({
          colonne: p.lue.colonne(
            type === 'department' && p.lue.departement ? 'departement' : 'poste',
          ),
          texte: `« ${nomPropre} » n’existe pas dans l’organigramme : sa création revient à qui gère l’organigramme`,
        });
        return null;
      }
      // La clé tient au nom tiré du fichier, pas au nom corrigé : elle reste
      // la même d'un aperçu à l'autre, et l'unité garde sa correction.
      const parentCle = 'unite' in parent ? parent.unite.id : parent.nouvelle.cle;
      const cleNouvelle = `${type}:${parentCle}:${cleDUnite(nomPropre)}`;
      const deja = this.aCreer.find((u) => u.cle === cleNouvelle);
      if (deja) return { nouvelle: deja };
      const nouvelle: UniteACreer = {
        cle: cleNouvelle,
        nom: this.noms[cleNouvelle]?.trim() || nomPropre,
        propose: nomPropre,
        type,
        parent,
        id: null,
        echec: null,
      };
      this.aCreer.push(nouvelle);
      return { nouvelle };
    };

    for (const p of this.plans) {
      if (p.rapport.etat === 'erreur') continue;
      const l = p.lue;
      const nature: NaturePoste = l.poste?.nature ?? { nature: 'agent' };
      let direction: Unite | null = null;
      if (l.direction) {
        const t = trouverDirection(l.direction);
        if (t) {
          direction = t.unite;
          if (t.corrige) {
            p.rapport.corrections.push({
              colonne: l.colonne('direction'),
              lu: l.direction,
              retenu: t.unite.sigle ?? t.unite.nom,
            });
          }
        } else {
          p.rapport.avertissements.push({
            colonne: l.colonne('direction'),
            texte: `« ${l.direction} » n’est pas une direction de l’organigramme : agent importé sans unité`,
          });
        }
      } else if (nature.nature === 'directeur' && nature.precision) {
        // Sans direction écrite, « Directeur financier et comptable » la nomme.
        const nommees = directions.filter(
          (d) => !d.sommet && designeLaDirection(nature.precision, { nom: d.nom, sigle: d.sigle }),
        );
        if (nommees.length === 1) {
          direction = nommees[0]!;
          p.rapport.corrections.push({
            colonne: l.colonne('direction'),
            lu: '',
            retenu: `${direction.sigle ?? direction.nom}, d’après le poste`,
          });
        }
      }

      const departement =
        l.departement && direction
          ? trouverOuCreer('department', l.departement, { unite: direction }, direction, p)
          : null;
      const parDefaut: Place | null = departement ?? (direction ? { unite: direction } : null);

      switch (nature.nature) {
        case 'dg':
        case 'dga':
          p.place = sommet ? { unite: sommet } : parDefaut;
          if (sommet) {
            p.designation = {
              place: nature.nature === 'dg' ? 'tete' : 'adjoint',
              unite: { unite: sommet },
            };
          }
          break;
        case 'sg':
          p.place = parDefaut;
          if (direction && !direction.sommet && estSecretariatGeneral(direction.nom)) {
            p.place = { unite: direction };
            p.designation = { place: 'tete', unite: { unite: direction } };
          }
          break;
        case 'directeur':
          if (
            direction &&
            !direction.sommet &&
            designeLaDirection(nature.precision, { nom: direction.nom, sigle: direction.sigle })
          ) {
            p.place = { unite: direction };
            p.designation = { place: 'tete', unite: { unite: direction } };
          } else {
            p.place = parDefaut;
          }
          break;
        case 'chef': {
          const nom = nature.nom ?? (nature.type === 'department' ? l.departement : null);
          if (!direction) {
            p.rapport.avertissements.push({
              colonne: l.colonne('direction'),
              texte: `Direction manquante : le ${nature.type === 'department' ? 'département' : 'service'} du poste ne se situe pas, pas de désignation`,
            });
            break;
          }
          if (!nom) {
            p.place = parDefaut;
            p.rapport.avertissements.push({
              colonne: l.colonne('poste'),
              texte: `Le poste ne nomme pas le ${nature.type === 'department' ? 'département' : 'service'} : pas de désignation`,
            });
            break;
          }
          const unite =
            nature.type === 'department'
              ? departement && cleDUnite(nom) === cleDUnite(l.departement ?? '')
                ? departement
                : trouverOuCreer('department', nom, { unite: direction }, direction, p)
              : trouverOuCreer('service', nom, departement ?? { unite: direction }, direction, p);
          p.place = unite ?? parDefaut;
          if (unite) p.designation = { place: 'tete', unite };
          if (unite && nature.type === 'service') {
            this.aRangerSous(unite, direction, departement, p.lue.ligne);
          }
          break;
        }
        default:
          p.place = parDefaut;
      }
      p.rapport.unite = p.place ? nomDeLaPlace(p.place) : null;
    }
    // Les départements que le fichier crée sont tous connus : chaque service
    // trouve le sien.
    this.rangerLesServices();
    this.placerALaMain();
  }

  /**
   * L'import décide de l'unité de l'agent : une fiche qu'il crée, ou une
   * fiche qui n'a pas encore d'unité. Pas le responsable que l'import
   * désigne : sa place est l'unité à diriger.
   */
  private placeParLImport(p: Plan): boolean {
    if (p.rapport.etat === 'erreur' || p.designation || !p.lue.poste) return false;
    const d = p.dossier;
    if (!d) return true;
    if (!d.affectation) return d.nbAffectations === 0;
    return !d.affectation.uniteId;
  }

  /**
   * Les agents affectés à l'aperçu à une unité de leur direction (ADR-0179),
   * parmi les agents dont l'import décide l'unité.
   */
  private placerALaMain(): void {
    const voulus = Object.entries(this.reglages.placements ?? {});
    if (voulus.length === 0) return;
    const places = new Map<string, Place>();
    for (const unite of this.unites) places.set(cleCourte(`u:${unite.id}`), { unite });
    for (const nouvelle of this.aCreer) places.set(cleCourte(nouvelle.cle), { nouvelle });
    const parLigne = new Map(this.plans.map((p) => [p.lue.ligne, p]));
    for (const [cle, lignes] of voulus) {
      const cible = places.get(cle);
      const direction = cible ? this.directionDeLaPlace(cible) : null;
      if (!cible || !direction) continue;
      for (const ligne of lignes) {
        const p = parLigne.get(ligne);
        if (!p || !this.placeParLImport(p)) continue;
        if (this.directionDeLaPlace(p.place)?.id !== direction.id) continue;
        p.place = cible;
        p.rapport.unite = nomDeLaPlace(cible);
      }
    }
  }

  /**
   * Un service rangé directement sous sa direction, que l'import crée ou
   * qu'un import précédent a créé, attend de savoir si elle compte des
   * départements. Un service saisi à la main reste où la DCH l'a mis.
   */
  private aRangerSous(
    service: Place,
    direction: Unite,
    departement: Place | null,
    ligne: number,
  ): void {
    let cle: string;
    if ('nouvelle' in service) {
      const parent = service.nouvelle.parent;
      if (!('unite' in parent) || parent.unite.id !== direction.id) return;
      cle = service.nouvelle.cle;
    } else {
      const u = service.unite;
      if (u.parentId !== direction.id || !u.creeParLImport) return;
      if (!peut(this.user, 'organigramme')) return;
      cle = `u:${u.id}`;
    }
    const deja = this.aRanger.get(cle);
    if (deja) {
      deja.lignes.push(ligne);
      deja.departement ??= departement;
      return;
    }
    this.aRanger.set(cle, { cle, service, direction, departement, lignes: [ligne] });
  }

  /** Les départements d'une direction : ceux de l'organigramme, puis ceux que l'import crée. */
  private departementsDe(direction: Unite): Place[] {
    const places: Place[] = [
      ...this.unites
        .filter((u) => u.type === 'department' && u.parentId === direction.id)
        .map((unite) => ({ unite })),
      ...this.aCreer
        .filter(
          (u) =>
            u.type === 'department' && 'unite' in u.parent && u.parent.unite.id === direction.id,
        )
        .map((nouvelle) => ({ nouvelle })),
    ];
    return places.sort((a, b) => nomDeLaPlace(a).localeCompare(nomDeLaPlace(b), 'fr'));
  }

  /**
   * Un service se range sous un département de sa direction (ADR-0178) :
   * celui que nomme la ligne, sinon le seul que compte la direction, sinon
   * celui que la DCH choisit à l'aperçu. Une direction sans département
   * garde ses services.
   */
  private rangerLesServices(): void {
    const cleDe = (d: Place) => ('unite' in d ? `u:${d.unite.id}` : d.nouvelle.cle);
    for (const s of this.aRanger.values()) {
      const departements = this.departementsDe(s.direction);
      let cible = s.departement ?? (departements.length === 1 ? departements[0]! : null);
      if (!cible && departements.length > 1) {
        const voulu = this.rattachements[s.cle];
        cible = departements.find((d) => cleDe(d) === voulu) ?? null;
        this.rattachementsDemandes.push({
          cle: s.cle,
          service: nomDeLaPlace(s.service),
          direction: s.direction.sigle ?? s.direction.nom,
          lignes: s.lignes,
          departements: departements.map((d) => ({ cle: cleDe(d), nom: nomDeLaPlace(d) })),
          retenu: cible ? cleDe(cible) : null,
        });
        if (!cible) {
          for (const p of this.plans) {
            if (!s.lignes.includes(p.lue.ligne)) continue;
            p.rapport.avertissements.push({
              colonne: p.lue.colonne('poste'),
              texte: `Choisissez le département auquel rattacher « ${nomDeLaPlace(s.service)} »`,
            });
          }
        }
      }
      if (!cible) continue;
      if ('nouvelle' in s.service) s.service.nouvelle.parent = cible;
      else this.deplacements.push({ service: s.service.unite, vers: cible, lignes: s.lignes });
    }
  }

  /** La direction d'une place : la sienne, ou celle de l'unité qui l'accueille. */
  private directionDeLaPlace(place: Place | null): Unite | null {
    if (!place) return null;
    if ('nouvelle' in place) return this.directionDeLaPlace(place.nouvelle.parent);
    return this.unites.find((u) => u.id === place.unite.directionId) ?? null;
  }

  /* ─── Le N+1 et le responsable fonctionnel, retrouvés par leur nom ─── */

  private nommer(): void {
    const parDossier = new Map<string, Personne>();
    const sigleDe = (u: Unite | null) => u?.sigle ?? u?.nom ?? null;
    for (const d of this.dossiers) {
      if (!d.enActivite) continue;
      const unite = d.affectation?.uniteId
        ? (this.unites.find((u) => u.id === d.affectation!.uniteId) ?? null)
        : null;
      const personne: Personne = {
        cle: `d:${d.id}`,
        nom: `${d.prenom} ${d.nom}`,
        detail: [
          d.matricule,
          d.affectation?.titre,
          sigleDe(this.directionDeLaPlace(unite ? { unite } : null)),
        ]
          .filter(Boolean)
          .join(' · '),
        noms: new Set([cleDeNom(`${d.prenom} ${d.nom}`)]),
        matricules: new Set([cleMatricule(d.matricule)]),
        id: () => d.id,
      };
      this.personnes.push(personne);
      parDossier.set(d.id, personne);
    }
    for (const p of this.plans) {
      if (p.rapport.etat === 'erreur') continue;
      const nom = cleDeNom(`${p.lue.prenom} ${p.lue.nom}`);
      if (p.dossier) {
        parDossier.get(p.dossier.id)?.noms.add(nom);
        parDossier.get(p.dossier.id)?.matricules.add(cleMatricule(p.lue.matricule));
        continue;
      }
      this.personnes.push({
        cle: `l:${p.lue.ligne}`,
        nom: `${p.lue.prenom} ${p.lue.nom}`,
        detail: [
          `ligne ${p.lue.ligne}`,
          p.lue.poste?.intitule,
          sigleDe(this.directionDeLaPlace(p.place)),
        ]
          .filter(Boolean)
          .join(' · '),
        noms: new Set([nom]),
        matricules: new Set(p.provisoire ? [] : [cleMatricule(p.matricule)]),
        id: () => p.employeeId,
      });
    }

    const cleDe = (p: Plan) => (p.dossier ? `d:${p.dossier.id}` : `l:${p.lue.ligne}`);
    const leDG = this.plans.find(
      (p) => p.rapport.etat !== 'erreur' && p.lue.poste?.nature.nature === 'dg' && p.designation,
    );
    const sommet = this.unites.find((u) => u.sommet);

    for (const role of ['n1', 'fonctionnel'] as const) {
      for (const p of this.plans) {
        if (p.rapport.etat === 'erreur') continue;
        const ecrit = p.lue[role];
        if (!ecrit) continue;
        const colonne = p.lue.colonne(role);
        const cle = cleDeNom(ecrit);
        const pasSoi = (c: Personne) => c.cle !== cleDe(p);
        let exacts: Personne[];
        if (['dg', 'directeur general', 'directrice generale'].includes(squelette(ecrit))) {
          const dg = leDG
            ? this.personnes.find((c) => c.cle === cleDe(leDG))
            : sommet?.tete
              ? parDossier.get(sommet.tete)
              : undefined;
          exacts = dg ? [dg] : [];
        } else {
          exacts = this.personnes.filter(
            (c) => c.noms.has(cle) || c.matricules.has(cleMatricule(ecrit)),
          );
        }
        exacts = exacts.filter(pasSoi);
        if (exacts.length === 1) {
          p[role] = exacts[0]!.cle;
          continue;
        }
        // Personne à ce nom exact : les noms à une faute près se proposent,
        // ils ne se devinent pas.
        const candidats =
          exacts.length > 0
            ? exacts
            : this.personnes.filter(
                (c) => pasSoi(c) && [...c.noms].some((n) => nomsProches(n, cle)),
              );
        if (candidats.length === 0) {
          p.rapport.avertissements.push({
            colonne,
            texte: `« ${ecrit} » ne se retrouve pas parmi les agents : à désigner sur la fiche`,
          });
          continue;
        }
        // La fiche a déjà pour N+1 une personne de ce nom : c'est le choix fait
        // au premier import, il ne se redemande pas.
        const actuel = p.dossier ? (role === 'n1' ? p.dossier.n1 : p.dossier.fonctionnel) : null;
        const garde = actuel ? candidats.find((c) => c.cle === `d:${actuel}`) : undefined;
        if (garde) {
          p[role] = garde.cle;
          continue;
        }
        const direction = this.directionDeLaPlace(p.place);
        const cleChoix = `${role}:${cle}:${direction?.id ?? '-'}`;
        let demande = this.choixDemandes.get(cleChoix);
        if (!demande) {
          const retenu = this.choix[cleChoix];
          demande = {
            cle: cleChoix,
            role,
            colonne,
            nom: ecrit,
            lignes: [],
            candidats: candidats.map((x): CandidatImport => ({
              cle: x.cle,
              nom: x.nom,
              detail: x.detail,
            })),
            retenu:
              retenu === CHOIX_AUCUN || candidats.some((x) => x.cle === retenu) ? retenu! : null,
          };
          this.choixDemandes.set(cleChoix, demande);
        }
        demande.lignes.push(p.lue.ligne);
        if (demande.retenu && demande.retenu !== CHOIX_AUCUN) {
          p[role] = demande.retenu;
        } else if (!demande.retenu) {
          p.rapport.avertissements.push({
            colonne,
            texte:
              exacts.length > 1
                ? `${exacts.length} personnes s’appellent « ${ecrit} » : choisissez laquelle`
                : `« ${ecrit} » ne se retrouve pas tel quel : choisissez la personne`,
          });
        }
      }
    }
  }

  /** Le dossier que désigne une personne, une fois les fiches écrites. */
  private idDe(cle: string | null): string | null {
    if (!cle) return null;
    return this.personnes.find((c) => c.cle === cle)?.id() ?? null;
  }

  private nomDe(cle: string | null): string | null {
    if (!cle) return null;
    return this.personnes.find((c) => c.cle === cle)?.nom ?? null;
  }

  /* ─── Ce que le fichier change sur une fiche existante ─── */

  private comparer(p: Plan): void {
    const d = p.dossier!;
    const l = p.lue;
    const personne: NonNullable<UpdateEmployeeInput['person']> = {};
    const emploi: NonNullable<UpdateEmployeeInput['employee']> = {};
    const noter = (champ: string, avant: string | null, apres: string) =>
      p.rapport.changements.push({ champ, avant, apres });
    const differe = (a: string | null | undefined, b: string | null | undefined) =>
      squelette(a ?? '') !== squelette(b ?? '');

    if (nomComparable(l.prenom) !== nomComparable(d.prenom)) {
      personne.givenName = l.prenom;
      noter('Prénom', d.prenom, l.prenom);
    }
    if (nomComparable(l.nom) !== nomComparable(d.nom)) {
      personne.familyName = l.nom;
      noter('Nom', d.nom, l.nom);
    }
    const v = l.personne;
    const avant = d.personne;
    if (v.gender && v.gender !== avant.gender) {
      personne.gender = v.gender;
      noter(
        'Sexe',
        avant.gender === 'male' || avant.gender === 'female' ? LIBELLES_SEXE[avant.gender] : null,
        LIBELLES_SEXE[v.gender],
      );
    }
    if (v.birthDate && v.birthDate !== avant.birthDate) {
      personne.birthDate = v.birthDate;
      noter(
        'Date de naissance',
        avant.birthDate ? dateLisible(avant.birthDate) : null,
        dateLisible(v.birthDate),
      );
    }
    for (const [cle, champ] of [
      ['birthPlace', 'Pays de naissance'],
      ['lieuDeNaissance', 'Lieu de naissance'],
      ['addressLine', 'Adresse'],
      ['ville', 'Ville'],
      ['emergencyContactName', 'Personne à contacter en cas d’urgence'],
      ['prenomDuPere', 'Prénom du père'],
      ['prenomDeLaMere', 'Prénom de la mère'],
      ['nomDeLaMere', 'Nom de la mère'],
    ] as const) {
      const nouveau = v[cle];
      if (nouveau && differe(nouveau, avant[cle])) {
        personne[cle] = nouveau;
        noter(champ, avant[cle], nouveau);
      }
    }
    for (const [cle, champ] of [
      ['phone', 'Téléphone personnel'],
      ['emergencyContactPhone', 'Téléphone du contact d’urgence'],
      ['personalEmail', 'Adresse mail personnelle'],
    ] as const) {
      const nouveau = v[cle];
      const ancien = avant[cle];
      const simple = (t: string | null) => (t ?? '').replace(/\s/g, '').toLowerCase();
      if (nouveau && simple(nouveau) !== simple(ancien)) {
        personne[cle] = nouveau;
        noter(champ, ancien, nouveau);
      }
    }
    if (v.maritalStatus && v.maritalStatus !== avant.maritalStatus) {
      personne.maritalStatus = v.maritalStatus;
      noter(
        'Situation matrimoniale',
        avant.maritalStatus ? (LIBELLES_SITUATION[avant.maritalStatus] ?? null) : null,
        LIBELLES_SITUATION[v.maritalStatus]!,
      );
    }
    const epousesAvant = avant.epouses;
    if (
      v.epouses &&
      v.epouses.map(nomComparable).join('|') !== epousesAvant.map(nomComparable).join('|')
    ) {
      personne.epouses = v.epouses;
      noter(
        'Épouses',
        epousesAvant.length > 0 ? epousesAvant.join(', ') : null,
        v.epouses.join(', '),
      );
    }
    // Plus marié, ou plus un homme : les épouses s'en vont, comme sur le formulaire.
    const genre = personne.gender ?? avant.gender;
    const situation = personne.maritalStatus ?? avant.maritalStatus;
    if (
      !personne.epouses &&
      epousesAvant.length > 0 &&
      (genre !== 'male' || situation !== 'married')
    ) {
      personne.epouses = [];
      noter('Épouses', epousesAvant.join(', '), 'aucune');
    }
    if (v.nombreEnfants !== undefined && v.nombreEnfants !== avant.nombreEnfants) {
      personne.nombreEnfants = v.nombreEnfants;
      noter(
        'Nombre d’enfants',
        avant.nombreEnfants === null ? null : String(avant.nombreEnfants),
        String(v.nombreEnfants),
      );
    }
    if (v.region && v.region !== avant.region) {
      personne.region = v.region;
      noter(
        'Région',
        avant.region
          ? (LIBELLES_REGION[avant.region as keyof typeof LIBELLES_REGION] ?? null)
          : null,
        LIBELLES_REGION[v.region],
      );
    }
    if (v.lienContactUrgence && v.lienContactUrgence !== avant.lienContactUrgence) {
      personne.lienContactUrgence = v.lienContactUrgence;
      noter(
        'Lien de parenté',
        avant.lienContactUrgence
          ? (LIBELLES_LIEN_DE_PARENTE[
              avant.lienContactUrgence as keyof typeof LIBELLES_LIEN_DE_PARENTE
            ] ?? null)
          : null,
        LIBELLES_LIEN_DE_PARENTE[v.lienContactUrgence],
      );
    }
    if (v.nationalId && (v.nationalId !== d.cni || d.typePiece !== 'cni')) {
      if (peut(this.user, 'personnel.sensible')) {
        personne.nationalId = v.nationalId;
        personne.idDocumentType = 'cni';
        noter('Numéro CNI', d.cni, v.nationalId);
      } else {
        p.rapport.avertissements.push({
          colonne: l.colonne('cni'),
          texte:
            'Différent de la fiche, et réservé à l’accès aux données sensibles : non mis à jour',
        });
      }
    }

    // L'emploi.
    if (p.matricule !== d.matricule) {
      emploi.employeeNumber = p.matricule;
      noter('Matricule', d.matricule, p.matricule);
    }
    const entree = l.entree;
    const memeMois = d.hiredOn.slice(0, 7) === entree.iso.slice(0, 7);
    if (entree.auMois ? !memeMois : entree.iso !== d.hiredOn || d.entreeAuMois) {
      emploi.hiredOn = entree.iso;
      noter(
        'Date d’entrée',
        dateLisible(d.hiredOn, d.entreeAuMois),
        dateLisible(entree.iso, entree.auMois),
      );
    }
    const e = l.emploi;
    if (e.workEmail && e.workEmail.toLowerCase() !== (d.emploi.workEmail ?? '').toLowerCase()) {
      emploi.workEmail = e.workEmail;
      noter('Adresse mail professionnelle', d.emploi.workEmail, e.workEmail);
    }
    if (e.workPhone && e.workPhone !== d.emploi.workPhone) {
      emploi.workPhone = e.workPhone;
      noter('Téléphone professionnel', d.emploi.workPhone, e.workPhone);
    }
    if (e.personnel && e.personnel !== d.emploi.personnel) {
      emploi.personnel = e.personnel;
      noter(
        'Statut',
        d.emploi.personnel === 'cadre' || d.emploi.personnel === 'non_cadre'
          ? LIBELLES_PERSONNEL[d.emploi.personnel]
          : null,
        LIBELLES_PERSONNEL[e.personnel],
      );
    }
    for (const [cle, champ] of [
      ['lieuDeTravail', 'Lieu de travail'],
      ['projet', 'Projet'],
      ['categorie', 'Catégorie socio-professionnelle'],
    ] as const) {
      const nouveau = e[cle];
      if (nouveau && differe(nouveau, d.emploi[cle])) {
        emploi[cle] = nouveau;
        noter(champ, d.emploi[cle], nouveau);
      }
    }
    // La rémunération, la banque et l'IPRES.
    const remuneration: NonNullable<UpdateEmployeeInput['remuneration']> = {};
    const r = this.remunerationPermise(p);
    const fiche = d.remuneration;
    if (r) {
      for (const cle of MONTANTS) {
        const nouveau = r[cle];
        const ancien = fiche[cle];
        if (nouveau !== undefined && nouveau !== ancien) {
          remuneration[cle] = nouveau;
          noter(
            LIBELLES_DES_MONTANTS[cle],
            ancien === null ? null : montantLisible(ancien),
            montantLisible(nouveau),
          );
        }
      }
      if (r.nombreDeParts !== undefined && r.nombreDeParts !== fiche.nombreDeParts) {
        remuneration.nombreDeParts = r.nombreDeParts;
        noter(
          'Nombre de parts',
          fiche.nombreDeParts === null ? null : fiche.nombreDeParts.toLocaleString('fr-FR'),
          r.nombreDeParts.toLocaleString('fr-FR'),
        );
      }
      if (r.banque && r.banque !== fiche.banque) {
        remuneration.banque = r.banque;
        noter('Banque', fiche.banque ? banqueDe(fiche.banque).nom : null, banqueDe(r.banque).nom);
      }
      if (r.rib && r.rib !== fiche.rib) {
        remuneration.rib = r.rib;
        noter('RIB', fiche.rib ? ribGroupe(fiche.rib) : null, ribGroupe(r.rib));
      }
      if (r.domiciliation !== undefined && r.domiciliation !== fiche.domiciliation) {
        remuneration.domiciliation = r.domiciliation;
        noter(
          'Domiciliation',
          fiche.domiciliation === null ? null : ouiNon(fiche.domiciliation),
          ouiNon(r.domiciliation),
        );
      }
      for (const [cle, champ] of [
        ['autresAvantages', 'Autres avantages'],
        ['numeroIpres', 'Numéro IPRES'],
      ] as const) {
        const nouveau = r[cle];
        if (nouveau && differe(nouveau, fiche[cle])) {
          remuneration[cle] = nouveau;
          noter(champ, fiche[cle], nouveau);
        }
      }
    }
    p.patch = {
      ...(Object.keys(personne).length > 0 ? { person: personne } : {}),
      ...(Object.keys(emploi).length > 0 ? { employee: emploi } : {}),
      ...(Object.keys(remuneration).length > 0 ? { remuneration } : {}),
    };

    // L'affectation : compléter ce qui manque, corriger l'intitulé, jamais muter.
    const titre = l.poste?.intitule;
    if (!d.affectation) {
      if (d.nbAffectations === 0 && titre) {
        p.affectation = { creer: true, titre, ...(p.place ? { unite: p.place } : {}) };
        noter('Poste', null, titre);
      }
    } else if (!p.designation) {
      const a = d.affectation;
      if (p.place) {
        const cible = 'unite' in p.place ? p.place.unite : null;
        if (!a.uniteId) {
          p.affectation = { unite: p.place };
          noter('Unité', null, nomDeLaPlace(p.place));
        } else if (!cible || !this.dans(a.uniteId, cible)) {
          p.rapport.avertissements.push({
            colonne: l.colonne('direction'),
            texte: `${nomDeLaPlace(p.place)} dans le fichier, ${this.nomUnite(a.uniteId)} sur la fiche : une mutation se fait depuis la fiche`,
          });
        }
      }
      if (titre && squelette(titre) !== squelette(a.titre)) {
        if (a.responsable) {
          p.rapport.avertissements.push({
            colonne: l.colonne('poste'),
            texte: `« ${titre} » dans le fichier, mais ${d.prenom} ${d.nom} dirige ${this.nomUnite(a.uniteId)} : poste inchangé`,
          });
        } else {
          p.affectation = { ...(p.affectation ?? {}), titre };
          noter('Poste', a.titre, titre);
        }
      }
    }

    // Le contrat : le premier se crée ; un autre type ou une autre fin se saisit sur la fiche.
    const c = l.contrat;
    if (c) {
      if (d.nbContrats === 0) {
        p.creerContrat = true;
        noter('Contrat', null, c.fin ? `CDD jusqu’au ${dateLisible(c.fin)}` : 'CDI');
      } else if (d.contrat && d.contrat.type !== c.type) {
        p.rapport.avertissements.push({
          colonne: l.colonne('contrat'),
          texte: `${c.type.toUpperCase()} dans le fichier, ${d.contrat.type.toUpperCase()} sur la fiche : un nouveau contrat se saisit depuis la fiche`,
        });
      } else if (d.contrat && c.type === 'cdd' && c.fin && c.fin !== d.contrat.fin) {
        p.rapport.avertissements.push({
          colonne: l.colonne('finCdd'),
          texte: `Fin au ${dateLisible(c.fin)} dans le fichier, ${d.contrat.fin ? `au ${dateLisible(d.contrat.fin)}` : 'sans fin'} sur la fiche : un renouvellement se saisit depuis la fiche`,
        });
      }
    }
  }

  /** L'unité `id` est-elle `cible`, ou dans son périmètre (un service de ce département) ? */
  private dans(id: string, cible: Unite): boolean {
    if (id === cible.id) return true;
    const u = this.unites.find((x) => x.id === id);
    if (!u) return false;
    if (cible.type === 'direction') return u.directionId === cible.id;
    if (cible.type === 'department') return u.parentId === cible.id;
    return false;
  }

  private nomUnite(id: string | null): string {
    const u = id ? this.unites.find((x) => x.id === id) : undefined;
    return u ? (u.sigle ?? u.nom) : 'aucune unité';
  }

  /** Son propre dossier, ou un dossier inactif : l'import n'y touche pas. */
  private refuserCeQuiNeSeModifiePas(): void {
    for (const p of this.plans) {
      const d = p.dossier;
      if (!d || p.rapport.etat === 'erreur') continue;
      const connu = (cle: string | null) => (cle?.startsWith('d:') ? cle.slice(2) : null);
      // Une désignation déjà faite ne change rien : qui dirige déjà son unité
      // n'a rien à refuser.
      const unite = p.designation ? this.uniteDeLaPlace(p.designation.unite) : null;
      const designe =
        p.designation !== null &&
        (p.designation.place === 'adjoint' ? unite?.adjoint : unite?.tete) !== d.id;
      const touche =
        p.rapport.changements.length > 0 ||
        designe ||
        (p.n1 !== null && connu(p.n1) !== d.n1) ||
        (p.fonctionnel !== null && connu(p.fonctionnel) !== d.fonctionnel);
      if (!touche) continue;
      const motif = d.soi
        ? 'Votre propre dossier ne se modifie pas par l’import : une autre personne de la DCH s’en charge'
        : !d.actif
          ? 'Dossier inactif : réactivez-le depuis la fiche, puis relancez l’import'
          : null;
      if (!motif) continue;
      p.rapport.etat = 'erreur';
      p.rapport.motif = motif;
      p.rapport.colonne = null;
      p.rapport.changements = [];
    }
  }

  /* ─── L'écriture : unités, fiches, responsables, N+1, responsables fonctionnels ─── */

  /** Une écriture, avec son point de reprise : refusée, elle n'emporte rien d'autre. */
  private async essayer<T>(fn: (sp: Tx) => Promise<T>): Promise<{ ok: T } | { erreur: string }> {
    try {
      return { ok: await this.tx.transaction(fn) };
    } catch (err) {
      if (!(err instanceof ProblemException)) {
        this.journal.warn(`Écriture refusée pendant l’import : ${(err as Error)?.message ?? err}`);
      }
      return { erreur: messageDErreur(err) };
    }
  }

  private idDeLaPlace(place: Place | null | undefined): string | null {
    if (!place) return null;
    return 'unite' in place ? place.unite.id : place.nouvelle.id;
  }

  private async creerLesUnites(): Promise<void> {
    // Les départements d'abord : un service peut se ranger sous l'un d'eux.
    const ordre = [...this.aCreer].sort(
      (a, b) => (a.type === 'department' ? 0 : 1) - (b.type === 'department' ? 0 : 1),
    );
    const echouee = (u: UniteACreer, raison: string) => {
      u.echec = raison;
      this.unitesCreees.push({
        cle: u.cle,
        nom: u.nom,
        propose: u.propose,
        parent: nomDeLaPlace(u.parent),
        echec: raison,
      });
    };
    for (const u of ordre) {
      const parentId = this.idDeLaPlace(u.parent);
      if (!parentId) {
        echouee(u, 'son unité de rattachement n’a pas pu être créée');
        continue;
      }
      // Un nom corrigé à l'aperçu peut être celui d'une unité voisine.
      if (
        this.unites.some((x) => x.parentId === parentId && squelette(x.nom) === squelette(u.nom))
      ) {
        echouee(u, 'une unité porte déjà ce nom à ce niveau');
        continue;
      }
      const r = await this.essayer((sp) =>
        this.organigramme.creerDansLaTransaction(
          sp,
          this.user,
          { name: u.nom, unitType: u.type, parentId },
          { creeParLImport: true },
        ),
      );
      if ('erreur' in r) {
        echouee(u, r.erreur);
        continue;
      }
      u.id = r.ok.id;
      this.unites.push({
        id: r.ok.id,
        nom: u.nom,
        sigle: null,
        type: u.type,
        parentId,
        tete: null,
        adjoint: null,
        directionId: this.directionDeLaPlace(u.parent)?.id ?? null,
        sommet: false,
        creeParLImport: true,
      });
      this.unitesCreees.push({
        cle: u.cle,
        nom: u.nom,
        propose: u.propose,
        parent: nomDeLaPlace(u.parent),
      });
    }
    // Une unité qui n'a pas pu naître : ses agents vont à l'unité au-dessus.
    for (const p of this.plans) {
      let place = p.place;
      while (place && 'nouvelle' in place && !place.nouvelle.id) {
        p.rapport.avertissements.push({
          colonne: p.lue.colonne('poste'),
          texte: `Création de « ${place.nouvelle.nom} » impossible (${place.nouvelle.echec}) : agent affecté à ${nomDeLaPlace(place.nouvelle.parent)}`,
        });
        place = place.nouvelle.parent;
      }
      p.place = place;
      const d = p.designation?.unite;
      if (d && 'nouvelle' in d && !d.nouvelle.id) p.designation = null;
      if (
        p.affectation?.unite &&
        'nouvelle' in p.affectation.unite &&
        !p.affectation.unite.nouvelle.id
      ) {
        p.affectation.unite = place ?? undefined;
      }
    }
  }

  /**
   * Les services de l'organigramme que l'import range sous un département,
   * une fois les départements créés : le chef de chacun relève alors du chef
   * de ce département (règle 3 bis), comme l'organigramme le fait.
   */
  private async deplacerLesServices(): Promise<void> {
    const journal: Parameters<OrgUnitsService['designerDansLaTransaction']>[2] = [];
    for (const d of this.deplacements) {
      const parentId = this.idDeLaPlace(d.vers);
      const r = parentId
        ? await this.essayer((sp) =>
            this.organigramme.designerDansLaTransaction(sp, this.user, journal, d.service.id, {
              parentId,
            }),
          )
        : { erreur: 'le département n’a pas pu être créé' };
      if ('erreur' in r) {
        for (const p of this.plans) {
          if (!d.lignes.includes(p.lue.ligne)) continue;
          p.rapport.avertissements.push({
            colonne: p.lue.colonne('poste'),
            texte: `« ${d.service.nom} » reste rattaché à sa direction : ${r.erreur.replace(/\.$/, '')}`,
          });
        }
        continue;
      }
      d.service.parentId = parentId;
      this.servicesRanges.push({ service: d.service.nom, departement: nomDeLaPlace(d.vers) });
    }
  }

  /**
   * La rémunération que le fichier donne, si qui importe a l'accès aux
   * données sensibles ; sinon, l'aperçu nomme ses colonnes, non importées.
   */
  private remunerationPermise(p: Plan): Plan['lue']['remuneration'] | null {
    const r = p.lue.remuneration;
    if (Object.keys(r).length === 0 || !peut(this.user, 'personnel.sensible')) return null;
    return r;
  }

  private async ecrireLesDossiers(lesquels: (p: Plan) => boolean): Promise<void> {
    for (const p of this.plans) {
      if (p.rapport.etat === 'erreur' || !lesquels(p)) continue;
      const l = p.lue;
      if (!p.dossier) {
        const uniteId = this.idDeLaPlace(p.place);
        if (!l.poste && uniteId) {
          p.rapport.avertissements.push({
            colonne: l.colonne('poste'),
            texte: 'Poste manquant : agent importé sans affectation',
          });
        }
        const remuneration = this.remunerationPermise(p);
        const entree: CreateEmployeeInput = {
          person: { givenName: l.prenom, familyName: l.nom, ...l.personne },
          employee: { employeeNumber: p.matricule, hiredOn: l.entree.iso, ...l.emploi },
          ...(remuneration ? { remuneration } : {}),
          ...(l.contrat
            ? {
                contract: {
                  contractType: l.contrat.type,
                  startDate: l.entree.iso,
                  ...(l.contrat.fin ? { endDate: l.contrat.fin } : {}),
                },
              }
            : {}),
          ...(l.poste
            ? {
                assignment: {
                  positionTitle: l.poste.intitule,
                  startDate: l.entree.iso,
                  ...(uniteId ? { orgUnitId: uniteId } : {}),
                },
              }
            : {}),
        };
        const r = await this.essayer((sp) =>
          this.people.create(
            this.user,
            entree,
            {
              matriculeProvisoire: p.provisoire,
              entreeAuMois: l.entree.auMois,
              creeParLImport: true,
            },
            sp,
          ),
        );
        if ('ok' in r) {
          p.employeeId = r.ok.id;
          p.rapport.employeeId = r.ok.id;
        } else {
          p.rapport.etat = 'erreur';
          p.rapport.motif = r.erreur;
        }
        continue;
      }

      const d = p.dossier;
      if (Object.keys(p.patch).length === 0 && p.affectation === null && !p.creerContrat) continue;
      const r = await this.essayer(async (sp) => {
        if (Object.keys(p.patch).length > 0) {
          await this.people.update(this.user, d.id, p.patch, sp);
        }
        const hiredOn = p.patch.employee?.hiredOn;
        if (hiredOn) {
          // Une entrée connue au mois le reste ; le premier contrat et la
          // première affectation, partis de l'ancienne date, la suivent.
          await sp.execute(sql`
            UPDATE employees SET entree_au_mois = ${l.entree.auMois} WHERE id = ${d.id}`);
          await sp.execute(sql`
            UPDATE contracts SET start_date = ${hiredOn}::date, updated_at = now()
             WHERE id = (SELECT id FROM contracts WHERE employee_id = ${d.id}
                          ORDER BY start_date, created_at LIMIT 1)
               AND start_date = ${d.hiredOn}::date
               AND (end_date IS NULL OR end_date >= ${hiredOn}::date)`);
          await sp.execute(sql`
            UPDATE assignments SET validity = daterange(${hiredOn}::date, upper(validity))
             WHERE id = (SELECT id FROM assignments WHERE employee_id = ${d.id}
                          ORDER BY lower(validity) LIMIT 1)
               AND lower(validity) = ${d.hiredOn}::date
               AND (upper(validity) IS NULL OR upper(validity) > ${hiredOn}::date)`);
        }
        const debut = hiredOn ?? d.hiredOn;
        const unite = this.idDeLaPlace(p.affectation?.unite);
        if (p.affectation?.creer && p.affectation.titre) {
          await sp.execute(sql`
            INSERT INTO assignments (id, tenant_id, employee_id, org_unit_id, position_title, validity)
            VALUES (${uuidv7()}, ${this.user.tenantId}, ${d.id}, ${unite},
                    ${p.affectation.titre}, daterange(${debut}::date, NULL))`);
        } else if (p.affectation && d.affectation) {
          if (unite) {
            await sp.execute(sql`
              UPDATE assignments SET org_unit_id = ${unite} WHERE id = ${d.affectation.id}`);
          }
          if (p.affectation.titre) {
            await sp.execute(sql`
              UPDATE assignments SET position_title = ${p.affectation.titre}
               WHERE id = ${d.affectation.id}`);
          }
        }
        if (p.creerContrat && l.contrat) {
          await sp.execute(sql`
            INSERT INTO contracts (id, tenant_id, employee_id, contract_type, start_date, end_date)
            VALUES (${uuidv7()}, ${this.user.tenantId}, ${d.id}, ${l.contrat.type},
                    ${debut}::date, ${l.contrat.fin}::date)`);
        }
      });
      if ('erreur' in r) {
        p.rapport.etat = 'erreur';
        p.rapport.motif = r.erreur;
        p.rapport.changements = [];
      }
    }
  }

  /** Les responsables que les postes désignent : le DG d'abord, les chefs de service à la fin. */
  private async designer(): Promise<void> {
    const rang = (p: Plan) => {
      const n = p.lue.poste?.nature.nature;
      const u = p.designation ? this.uniteDeLaPlace(p.designation.unite) : null;
      if (n === 'dg') return 0;
      if (n === 'dga') return 1;
      if (u?.type === 'direction') return 2;
      if (u?.type === 'department') return 3;
      return 4;
    };
    const aDesigner = this.plans
      .filter((p) => p.designation && p.employeeId && p.rapport.etat !== 'erreur')
      .sort((a, b) => rang(a) - rang(b));
    if (aDesigner.length === 0) return;
    if (!peut(this.user, 'organigramme')) {
      for (const p of aDesigner) {
        p.rapport.avertissements.push({
          colonne: p.lue.colonne('poste'),
          texte: 'La désignation du responsable revient à qui gère l’organigramme',
        });
      }
      return;
    }
    const journal: Parameters<OrgUnitsService['designerDansLaTransaction']>[2] = [];
    for (const p of aDesigner) {
      const unite = this.uniteDeLaPlace(p.designation!.unite);
      const id = p.employeeId!;
      if (!unite) continue;
      const adjoint = p.designation!.place === 'adjoint';
      const actuel = adjoint ? unite.adjoint : unite.tete;
      if (actuel === id) continue;
      if (actuel && this.enActivite(actuel)) {
        p.rapport.avertissements.push({
          colonne: p.lue.colonne('poste'),
          texte: `${this.nomDuDossier(actuel)} ${adjoint ? 'est déjà DGA' : `dirige déjà ${unite.sigle ?? unite.nom}`} : désignation non faite`,
        });
        continue;
      }
      // Créée par l'import, la fiche prend la tête depuis son entrée ; une
      // fiche existante, depuis aujourd'hui.
      const depuis =
        !p.dossier && p.lue.entree.iso <= this.aujourdhui ? p.lue.entree.iso : undefined;
      const r = await this.essayer((sp) =>
        this.organigramme.designerDansLaTransaction(
          sp,
          this.user,
          journal,
          unite.id,
          adjoint ? { adjointEmployeeId: id, depuis } : { managerEmployeeId: id, depuis },
        ),
      );
      if ('erreur' in r) {
        p.rapport.avertissements.push({
          colonne: p.lue.colonne('poste'),
          texte: `Désignation impossible : ${r.erreur}`,
        });
        continue;
      }
      if (adjoint) unite.adjoint = id;
      else unite.tete = id;
      const genre = p.lue.personne.gender ?? p.dossier?.personne.gender ?? null;
      const poste = adjoint
        ? posteDAdjoint({ name: unite.nom, shortName: unite.sigle }, genre)
        : posteDeResponsable(
            { name: unite.nom, unitType: unite.type, shortName: unite.sigle, sommet: unite.sommet },
            genre,
          );
      this.designations.push({ poste, nom: `${p.lue.prenom} ${p.lue.nom}` });
      if (p.dossier) {
        p.rapport.changements.push({
          champ: 'Poste',
          avant: p.dossier.affectation?.titre ?? null,
          apres: poste,
        });
      }
    }
  }

  private uniteDeLaPlace(place: Place): Unite | null {
    const id = this.idDeLaPlace(place);
    return id ? (this.unites.find((u) => u.id === id) ?? null) : null;
  }

  private enActivite(id: string): boolean {
    const d = this.dossiers.find((x) => x.id === id);
    return d ? d.enActivite : this.plans.some((p) => p.employeeId === id);
  }

  private nomDuDossier(id: string): string {
    const d = this.dossiers.find((x) => x.id === id);
    if (d) return `${d.prenom} ${d.nom}`;
    const p = this.plans.find((x) => x.employeeId === id);
    return p ? `${p.lue.prenom} ${p.lue.nom}` : 'Une autre personne';
  }

  /** Le N+1, ou le responsable fonctionnel, que le fichier nomme. */
  private async rattacher(role: 'n1' | 'fonctionnel'): Promise<void> {
    const champ = role === 'n1' ? 'N+1' : 'Responsable fonctionnel';
    for (const p of this.plans) {
      const cible = p[role];
      if (!cible || !p.employeeId || p.rapport.etat === 'erreur') continue;
      const id = this.idDe(cible);
      if (!id) {
        p.rapport.avertissements.push({
          colonne: p.lue.colonne(role),
          texte: `Le dossier de ${this.nomDe(cible) ?? 'cette personne'} n’a pas pu être créé : ${champ} non attribué`,
        });
        continue;
      }
      const { rows } = await this.tx.execute<{ n1: string | null; f: string | null }>(sql`
        SELECT manager_employee_id AS n1, responsable_fonctionnel_id AS f
          FROM employees WHERE id = ${p.employeeId}`);
      const actuel = role === 'n1' ? rows[0]?.n1 : rows[0]?.f;
      if (actuel === id) continue;
      // Le N+1 d'un responsable s'impose (règle 3 bis) : le fichier qui en
      // nomme un autre est corrigé.
      const impose = role === 'n1' ? await this.n1Impose(p.employeeId) : null;
      if (impose && impose.id !== id) {
        p.rapport.corrections.push({
          colonne: p.lue.colonne('n1'),
          lu: p.lue.n1 ?? '',
          retenu: impose.libelle,
        });
        continue;
      }
      const employe = p.employeeId;
      const r = await this.essayer((sp) =>
        this.people.update(
          this.user,
          employe,
          {
            employee: role === 'n1' ? { managerEmployeeId: id } : { responsableFonctionnelId: id },
          },
          sp,
        ),
      );
      if ('erreur' in r) {
        p.rapport.avertissements.push({
          colonne: p.lue.colonne(role),
          texte: `${champ} non attribué à ${this.nomDe(cible) ?? 'cette personne'} : ${r.erreur.replace(/\.$/, '')}`,
        });
        continue;
      }
      if (p.dossier) {
        const avant = role === 'n1' ? p.dossier.n1 : p.dossier.fonctionnel;
        p.rapport.changements.push({
          champ,
          avant: avant ? this.nomDuDossier(avant) : null,
          apres: this.nomDe(cible) ?? '',
        });
      }
    }
  }

  /**
   * Le N+1 qu'impose une place de responsable : le DG pour un directeur,
   * l'unité au-dessus pour le chef d'un département ou d'un service.
   * `null` : rien n'est imposé.
   */
  private async n1Impose(employeeId: string): Promise<{ id: string; libelle: string } | null> {
    const place = await superieurAttendu(this.tx, employeeId);
    if (place) {
      const s = place.superieur;
      return s ? { id: s.id, libelle: `${s.nom}, responsable de « ${s.unite} »` } : null;
    }
    if (!(await dirigeUneDirection(this.tx, employeeId))) return null;
    const dg = await directeurGeneral(this.tx);
    return dg ? { id: dg, libelle: `${this.nomDuDossier(dg)}, DG` } : null;
  }

  /** Sans N+1 écrit, l'agent relève d'office du responsable de son unité (règle 5). */
  private async rattacherDOffice(): Promise<void> {
    for (const p of this.plans) {
      const id = p.employeeId;
      if (!id || p.rapport.etat === 'erreur') continue;
      await this.essayer((sp) => rattacherDOffice(sp, [], id));
    }
  }

  /**
   * L'organigramme tel que la passe l'a écrit : les unités vivantes, leur
   * responsable, et les agents actifs avec leur unité (en cours, sinon à
   * venir).
   */
  private async lireLEtat() {
    const { rows: unites } = await this.tx.execute<{
      id: string;
      name: string;
      short_name: string | null;
      unit_type: OrgUnitType;
      parent_id: string | null;
      sommet: boolean;
      tete: string | null;
      tete_prenom: string | null;
      tete_nom: string | null;
      tete_genre: 'female' | 'male' | null;
      tete_matricule: string | null;
    }>(sql`
      SELECT o.id, o.name, o.short_name, o.unit_type, o.parent_id, (o.id = ${SOMMET}) AS sommet,
             e.id AS tete, p.given_name AS tete_prenom, p.family_name AS tete_nom,
             p.gender AS tete_genre, e.employee_number AS tete_matricule
        FROM org_units o
        LEFT JOIN employees e ON e.id = o.manager_employee_id AND e.status = 'active'
        LEFT JOIN persons p ON p.id = e.person_id
       WHERE o.deleted_at IS NULL`);
    const { rows: agents } = await this.tx.execute<{
      id: string;
      prenom: string;
      nom: string;
      genre: string | null;
      matricule: string;
      poste: string | null;
      unite: string;
      stage: boolean;
      echu: boolean;
    }>(sql`
      SELECT e.id, p.given_name AS prenom, p.family_name AS nom, p.gender AS genre,
             e.employee_number AS matricule, a.position_title AS poste, a.org_unit_id AS unite,
             ${enStage(sql`e.id`)} AS stage, ${contratEchu(sql`e.id`)} AS echu
        FROM employees e
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
        JOIN LATERAL (
          SELECT av.org_unit_id, av.position_title FROM assignments av
           WHERE av.employee_id = e.id
             AND (av.validity @> CURRENT_DATE OR lower(av.validity) > CURRENT_DATE)
           ORDER BY lower(av.validity) LIMIT 1) a ON a.org_unit_id IS NOT NULL
       WHERE e.status = 'active'
       ORDER BY p.family_name, p.given_name, e.id`);
    const parId = new Map(unites.map((u) => [u.id, u]));
    const enfants = new Map<string, string[]>();
    for (const u of unites) {
      if (!u.parent_id) continue;
      enfants.set(u.parent_id, [...(enfants.get(u.parent_id) ?? []), u.id]);
    }
    /** L'unité et ce qui en descend, sans entrer dans les directions qu'elle coiffe. */
    const perimetreDe = (id: string): Set<string> => {
      const vus = new Set([id]);
      const pile = [id];
      while (pile.length > 0) {
        for (const e of enfants.get(pile.pop()!) ?? []) {
          if (vus.has(e) || parId.get(e)?.unit_type === 'direction') continue;
          vus.add(e);
          pile.push(e);
        }
      }
      return vus;
    };
    /** La plus proche direction en remontant, l'unité comprise. */
    const directionDe = (id: string) => {
      let u = parId.get(id);
      for (let i = 0; u && i < 64; i += 1) {
        if (u.unit_type === 'direction') return u;
        u = u.parent_id ? parId.get(u.parent_id) : undefined;
      }
      return undefined;
    };
    return { unites, agents, parId, perimetreDe, directionDe };
  }

  /** La clé d'une unité dans l'organigramme de l'aperçu. */
  private cleDeLUnite(id: string): string {
    return cleCourte(this.aCreer.find((n) => n.id === id)?.cle ?? `u:${id}`);
  }

  /** La clé de chaque personne : sa ligne dans le fichier, sinon son dossier. */
  private clesDesPersonnes(): (employeeId: string) => string {
    const lignes = new Map(
      this.plans.filter((p) => p.employeeId).map((p) => [p.employeeId!, p.lue.ligne]),
    );
    return (id) => (lignes.has(id) ? `l:${lignes.get(id)}` : `d:${id}`);
  }

  /**
   * Les unités où l'import met des agents et qui n'ont pas de responsable :
   * l'aperçu demande qui les dirige, parmi les agents de leur direction, ou
   * de les laisser « Non désigné » (ADR-0179). La personne retenue se désigne
   * ici, avec les règles et les cascades de l'organigramme.
   */
  private async designerALaMain(): Promise<void> {
    const venus = new Set(
      this.plans.filter((p) => p.employeeId && this.placeParLImport(p)).map((p) => p.employeeId!),
    );
    if (venus.size === 0) return;
    const etat = await this.lireLEtat();
    const cleDe = this.clesDesPersonnes();
    const dirigeants = new Set(etat.unites.map((u) => u.tete).filter((t): t is string => !!t));
    const aDesigner: {
      question: ResponsableImport;
      uniteId: string;
      employeeId: string;
      nom: string;
    }[] = [];
    for (const u of etat.unites) {
      if (u.tete) continue;
      const perimetre = etat.perimetreDe(u.id);
      const dedans = etat.agents.filter((a) => perimetre.has(a.unite));
      if (!dedans.some((a) => venus.has(a.id))) continue;
      const direction = etat.directionDe(u.id);
      const deLaDirection = direction ? etat.perimetreDe(direction.id) : perimetre;
      const candidats = etat.agents
        .filter((a) => deLaDirection.has(a.unite) && !a.stage && !a.echu && !dirigeants.has(a.id))
        // Les agents de l'unité d'abord, puis le reste de la direction.
        .sort((a, b) => Number(perimetre.has(b.unite)) - Number(perimetre.has(a.unite)));
      const cle = this.cleDeLUnite(u.id);
      const options = candidats.map((a) => ({
        cle: cleDe(a.id),
        nom: `${a.prenom} ${a.nom}`,
        detail: [a.matricule, a.poste, etat.parId.get(a.unite)?.name].filter(Boolean).join(' · '),
        id: a.id,
      }));
      const voulu = this.reglages.responsables?.[cle];
      const choisi = options.find((o) => o.cle === voulu);
      const question: ResponsableImport = {
        cle,
        unite: u.name,
        direction: direction ? (direction.short_name ?? direction.name) : u.name,
        effectif: dedans.length,
        candidats: options.map(({ cle: c, nom, detail }) => ({ cle: c, nom, detail })),
        retenu: voulu === CHOIX_AUCUN ? CHOIX_AUCUN : (choisi?.cle ?? null),
      };
      this.sansResponsable.push(question);
      if (choisi)
        aDesigner.push({ question, uniteId: u.id, employeeId: choisi.id, nom: choisi.nom });
    }
    if (aDesigner.length === 0) return;
    if (!peut(this.user, 'organigramme')) {
      for (const d of aDesigner) {
        d.question.echec = 'La désignation du responsable revient à qui gère l’organigramme';
      }
      return;
    }
    // La direction d'abord, puis le département, puis le service : chaque
    // responsable désigné trouve au-dessus de son unité le N+1 que la règle
    // impose.
    const rang = (id: string) => {
      const t = etat.parId.get(id)?.unit_type;
      return t === 'direction' ? 0 : t === 'department' ? 1 : 2;
    };
    const journal: Parameters<OrgUnitsService['designerDansLaTransaction']>[2] = [];
    for (const d of aDesigner.sort((a, b) => rang(a.uniteId) - rang(b.uniteId))) {
      const plan = this.plans.find((p) => p.employeeId === d.employeeId);
      // Une fiche créée par l'import prend la tête depuis son entrée, comme
      // pour une désignation que le poste fait.
      const depuis =
        plan && !plan.dossier && plan.lue.entree.iso <= this.aujourdhui
          ? plan.lue.entree.iso
          : undefined;
      const r = await this.essayer((sp) =>
        this.organigramme.designerDansLaTransaction(sp, this.user, journal, d.uniteId, {
          managerEmployeeId: d.employeeId,
          depuis,
        }),
      );
      if ('erreur' in r) {
        d.question.echec = r.erreur;
        continue;
      }
      const unite = etat.parId.get(d.uniteId)!;
      const genre = plan
        ? (plan.lue.personne.gender ?? plan.dossier?.personne.gender ?? null)
        : (etat.agents.find((a) => a.id === d.employeeId)?.genre ?? null);
      this.designations.push({
        poste: posteDeResponsable(
          {
            name: unite.name,
            unitType: unite.unit_type,
            shortName: unite.short_name,
            sommet: unite.sommet,
          },
          genre,
        ),
        nom: d.nom,
      });
      const connue = this.unites.find((x) => x.id === d.uniteId);
      if (connue) connue.tete = d.employeeId;
    }
  }

  /** L'organigramme que l'import laisse, pour l'aperçu (ADR-0179). */
  private async lireLOrganigramme(): Promise<void> {
    const etat = await this.lireLEtat();
    const parEmploye = new Map(
      this.plans.filter((p) => p.employeeId).map((p) => [p.employeeId!, p]),
    );
    const dirigeants = new Set(etat.unites.map((u) => u.tete).filter((t): t is string => !!t));
    this.noeuds = etat.unites.map((u) => ({
      cle: this.cleDeLUnite(u.id),
      nom: u.name,
      sigle: u.short_name,
      type: u.unit_type,
      parent: u.parent_id ? this.cleDeLUnite(u.parent_id) : null,
      sommet: Boolean(u.sommet),
      creee: this.aCreer.some((n) => n.id === u.id),
      responsable:
        u.tete && u.tete_prenom && u.tete_nom
          ? {
              nom: `${u.tete_prenom} ${u.tete_nom}`,
              nomAbrege: nomAbrege(u.tete_prenom, u.tete_nom),
              genre: u.tete_genre,
              matricule: u.tete_matricule ?? '',
            }
          : null,
    }));
    this.agentsFinaux = etat.agents.map((a) => {
      const p = parEmploye.get(a.id);
      return {
        cle: p ? `l:${p.lue.ligne}` : `d:${a.id}`,
        ligne: p?.lue.ligne ?? null,
        nom: `${a.prenom} ${a.nom}`,
        matricule: a.matricule,
        poste: a.poste,
        unite: this.cleDeLUnite(a.unite),
        modifiable: Boolean(p && this.placeParLImport(p) && !dirigeants.has(a.id)),
      };
    });
  }

  /** Ce que la base contient au bout de la passe : le poste, l'unité et le N+1 de chacun. */
  private async relire(): Promise<void> {
    const ids = this.plans.map((p) => p.employeeId).filter((x): x is string => !!x);
    if (ids.length === 0) return;
    const { rows } = await this.tx.execute<{
      id: string;
      n1: string | null;
      unite: string | null;
      sigle: string | null;
      titre: string | null;
    }>(sql`
      SELECT e.id, rp.given_name || ' ' || rp.family_name AS n1,
             o.name AS unite, o.short_name AS sigle, a.position_title AS titre
        FROM employees e
        LEFT JOIN employees re ON re.id = e.manager_employee_id
        LEFT JOIN persons rp ON rp.id = re.person_id
        LEFT JOIN LATERAL (
          SELECT av.org_unit_id, av.position_title FROM assignments av
           WHERE av.employee_id = e.id
             AND (av.validity @> CURRENT_DATE OR lower(av.validity) > CURRENT_DATE)
           ORDER BY lower(av.validity) LIMIT 1) a ON true
        LEFT JOIN org_units o ON o.id = a.org_unit_id
       WHERE e.id IN (${sql.join(
         ids.map((i) => sql`${i}::uuid`),
         sql`, `,
       )})`);
    const parId = new Map(rows.map((r) => [r.id, r]));
    for (const p of this.plans) {
      const r = p.employeeId ? parId.get(p.employeeId) : undefined;
      if (!r || p.rapport.etat === 'erreur') continue;
      p.rapport.responsable = r.n1;
      p.rapport.unite = r.unite ? (r.sigle ?? r.unite) : null;
      if (r.titre) p.rapport.poste = r.titre;
    }
  }
}
