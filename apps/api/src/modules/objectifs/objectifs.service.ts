import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import {
  type CreerObjectifInput,
  type DatesEvaluation,
  type DatesEvaluationInput,
  type EvaluerObjectifInput,
  type FicheSuivi,
  type FormationProposable,
  type MembreSuivi,
  type MesObjectifs,
  type EnregistrerFicheObjectifsInput,
  type FicheObjectifs,
  FICHE_OBJECTIFS_MAX,
  type FormationDeLaFiche,
  type StatutObjectifInput,
  type StatutObjectif,
  type CommentairesAgentInput,
  type EvaluationN1Input,
  type EvaluationValidee,
  type FicheEnregistree,
  type FixerObjectifsInput,
  type JoursEvaluation,
  type NoteGlobale,
  type ObjectifsFixes,
  type PeriodeObjectifs,
  JOURS_D_EVALUATION_PAR_DEFAUT,
  dateDEvaluation,
  dateEnLettres,
  echeanceDuBloc,
  formationsDeLaFiche,
  objectifsDeLaFiche,
  periodeDeLEcheance,
  statutsDesFormations,
  type ModifierObjectifInput,
  type ObjectifsAPIX,
  type ObjectifView,
  type Semestre,
  type SessionUser,
  type SuiviEquipe,
  type TeamCourseProgress,
} from '@teranga/contracts';
import { problem } from '../../common/problem';
import { TenantDb, type Tx } from '../../db/tenant-db';
import { duSemestre } from '../notifications/phrases';
import { AcademySuiviService } from '../academy/academy-suivi.service';
import { employeActif } from '../academy/academy-evaluation.service';
import { notifier } from '../notifications/notifier';
import { retirerLesAppels } from '../acces/appels';
import { prefixeEvaluation, reconcilierLesEvaluations } from './evaluation-attendue';
import {
  DG,
  SOMMET,
  directeurGeneral,
  directionDeEmploye,
  directionDeLUnite,
  dirigeUneDirection,
  uniteEnVigueur,
} from '../people/chaine';

/* ————————————————————————————————————————————————————————————————
   Les objectifs — qui les fixe, qui les voit.

   · Le directeur général fixe les orientations de l'APIX, diffusées à tous
     les agents ou aux directeurs seulement, et les objectifs de chaque
     direction (hors Direction Générale : ses orientations en tiennent lieu).
   · Le n+1 fixe ceux de ses DIRECTS — libres, ou une formation de l'Academy
     à suivre — et les évalue. Le n+1 qui compte est celui d'AUJOURD'HUI : un
     agent qui change de responsable garde ses objectifs, que le nouveau
     reprend.
   · L'agent voit les orientations qui lui sont diffusées, les objectifs de
     sa direction, et les siens.

   Tout se lit dans l'organigramme, comme la chaîne des visas : aucun rôle,
   aucune case à cocher.
   ———————————————————————————————————————————————————————————————— */

interface LigneObjectif extends Record<string, unknown> {
  id: string;
  niveau: 'apix' | 'direction' | 'individuel';
  annee: number;
  diffusion: 'tous' | 'directeurs' | null;
  direction_id: string | null;
  employee_id: string | null;
  nature: 'libre' | 'formation';
  course_id: string | null;
  titre: string;
  description: string | null;
  echeance: string | Date | null;
  evaluation: 'atteint' | 'partiel' | 'non_atteint' | null;
  evalue_le: string | Date | null;
  commentaire: string | null;
  auteur: string | null;
  created_at: string | Date;
}

interface LigneMembre extends Record<string, unknown> {
  id: string;
  employee_number: string;
  given_name: string;
  family_name: string;
  position_title: string | null;
  unite: string | null;
  direction_abrege: string | null;
  direction_nom: string | null;
  work_email: string | null;
  work_phone: string | null;
  phone: string | null;
  /** Parti de l'APIX : il ne reste là que le temps que son n+1 l'évalue. */
  parti: boolean;
}

/** Parti de l'APIX en laissant une auto-évaluation envoyée, pas encore validée. En SQL. */
const evaluationEnSuspens = (employeeId: SQL) => sql`(
  (SELECT es.status FROM employees es WHERE es.id = ${employeeId}) <> 'active'
  AND EXISTS (
    SELECT 1 FROM objectifs_fiches fs
     WHERE fs.employee_id = ${employeeId}
       AND fs.commentaires_envoyes_le IS NOT NULL AND fs.evaluation_validee_le IS NULL))`;

const iso = (d: string | Date | null): string | null =>
  d === null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();
const jour = (d: string | Date | null): string | null =>
  d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);

/**
 * Une fiche vient du navigateur : on n'y garde que des liens qu'on peut
 * suivre sans risque — http(s) et mailto. Un « javascript: » glissé dans un
 * bloc perdrait sa cible, le texte reste.
 */
function assainir(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(assainir);
  if (valeur === null || typeof valeur !== 'object') return valeur;
  const objet: Record<string, unknown> = {};
  for (const [cle, v] of Object.entries(valeur)) objet[cle] = assainir(v);
  if (objet.type === 'link' && typeof objet.href === 'string') {
    objet.href = /^(https?:|mailto:)/i.test(objet.href.trim()) ? objet.href.trim() : '';
  }
  return objet;
}

/** Une fiche dit quelque chose dès qu'un bloc porte du texte, une échéance ou une formation. */
function ficheRemplie(contenu: unknown): boolean {
  const texte = JSON.stringify(contenu);
  return /"text":"\s*[^"\s]/.test(texte) || /"type":"(echeance|formation)"/.test(texte);
}

/** Où en est l'agent des formations commencées — ce que les blocs « Formation » affichent. */
function formationsDe(progression: TeamCourseProgress[] | undefined): FormationDeLaFiche[] {
  return (progression ?? [])
    .filter((f): f is TeamCourseProgress & { courseId: string } => f.courseId !== null)
    .map((f) => ({
      courseId: f.courseId,
      statut: f.status,
      lecons: f.lessonCount,
      validees: f.completedLessons,
    }));
}

/** Une fiche d'objectifs, telle que la base la garde. */
type LigneFiche = {
  id: string;
  annee: number;
  semestre: number;
  contenu: Record<string, unknown>[];
  updated_at: string | Date;
  auteur: string | null;
  statuts: Record<string, StatutObjectif>;
  statuts_empreintes: Record<string, string>;
  formations_figees: FormationDeLaFiche[] | null;
  commentaires_agent: Record<string, string>;
  commentaires_envoyes_le: string | Date | null;
  commentaires_n1: Record<string, string>;
  evaluation_note: NoteGlobale | null;
  evaluation_validee_le: string | Date | null;
  evaluateur: string | null;
  evaluateur_employee_id: string | null;
};

const SELECTION_FICHE = sql`
  SELECT f.id, f.annee, f.semestre, f.contenu, f.updated_at,
         CASE WHEN pa.id IS NULL THEN NULL ELSE pa.given_name || ' ' || pa.family_name END AS auteur,
         f.statuts, f.statuts_empreintes, f.formations_figees,
         f.commentaires_agent, f.commentaires_envoyes_le, f.commentaires_n1,
         f.evaluation_note, f.evaluation_validee_le,
         CASE WHEN pv.id IS NULL THEN NULL ELSE pv.given_name || ' ' || pv.family_name END AS evaluateur,
         f.evaluateur_employee_id
    FROM objectifs_fiches f
    LEFT JOIN employees ea ON ea.id = f.auteur_employee_id
    LEFT JOIN persons pa ON pa.id = ea.person_id
    LEFT JOIN employees ev ON ev.id = f.evaluateur_employee_id
    LEFT JOIN persons pv ON pv.id = ev.person_id`;

/**
 * Les cases de la fiche disent ce que l'agent en dit : cochée, l'objectif est
 * atteint. Ce que le n+1 aurait coché en rédigeant ne compte pas.
 */
function avecLesStatuts(
  blocs: unknown,
  statuts: Record<string, StatutObjectif>,
): Record<string, unknown>[] {
  if (!Array.isArray(blocs)) return [];
  return (blocs as Record<string, unknown>[]).map((b) => {
    const enfants = avecLesStatuts(b.children, statuts);
    if (b.type !== 'checkListItem') return { ...b, children: enfants };
    return {
      ...b,
      props: {
        ...(b.props as Record<string, unknown>),
        checked: statuts[String(b.id)] === 'atteint',
      },
      children: enfants,
    };
  });
}

/** Un bloc de la fiche, tel que l'éditeur l'enregistre. */
type Bloc = Record<string, unknown>;

/** Une case sans texte n'est pas un objectif : elle ne s'enregistre pas. */
const caseVide = (b: Bloc) => b.type === 'checkListItem' && objectifsDeLaFiche([b]).length === 0;

/**
 * La case telle qu'elle se garde : avec son échéance, ou sans échéance à elle
 * (`null` : celle de sa fiche). Sans coche : c'est le statut donné par
 * l'agent qui la pose, à la lecture.
 */
function caseAGarder(b: Bloc, echeance: string | null): Bloc {
  const { echeance: _echeance, checked: _coche, ...props } = (b.props ?? {}) as Bloc;
  return { ...b, props: echeance ? { ...props, echeance } : props };
}

/**
 * À la lecture, chaque case porte son échéance. Une case fixée avant les
 * échéances n'en a pas à elle : elle prend la date d'évaluation de sa fiche.
 */
function avecLesEcheances(blocs: unknown, implicite: string): Bloc[] {
  if (!Array.isArray(blocs)) return [];
  return (blocs as Bloc[]).map((b) => {
    const enfants = avecLesEcheances(b.children, implicite);
    if (b.type !== 'checkListItem' || echeanceDuBloc(b)) return { ...b, children: enfants };
    const props = { ...((b.props ?? {}) as Bloc), echeance: implicite };
    return { ...b, props, children: enfants };
  });
}

/**
 * Les objectifs d'une fiche, de la plus proche échéance à la plus lointaine ;
 * à échéance égale, dans l'ordre où ils ont été fixés. Les formations et le
 * commentaire suivent, dans leur ordre. Les cases vides s'en vont.
 */
function ranger(contenu: Bloc[], implicite: string): Bloc[] {
  const cle = (b: Bloc) => echeanceDuBloc(b) ?? implicite;
  const cases = contenu.filter((b) => b.type === 'checkListItem' && !caseVide(b));
  // Le tri de JavaScript est stable : l'ordre d'arrivée départage.
  cases.sort((a, b) => (cle(a) < cle(b) ? -1 : cle(a) > cle(b) ? 1 : 0));
  return [...cases, ...contenu.filter((b) => b.type !== 'checkListItem')];
}

/**
 * Une fiche, le temps d'un geste qui peut en toucher plusieurs : fixer des
 * objectifs, enregistrer une fiche dont une échéance change de période,
 * déplacer les dates d'évaluation. Le geste se fait en mémoire, puis les
 * fiches touchées s'écrivent.
 */
interface FicheDuGeste extends PeriodeObjectifs {
  /** `null` : la fiche n'existe pas encore. */
  id: string | null;
  contenu: Bloc[];
  statuts: Record<string, StatutObjectif>;
  statuts_empreintes: Record<string, string>;
  commentaires_agent: Record<string, string>;
  commentaires_n1: Record<string, string>;
  /** L'agent a envoyé son auto-évaluation : la fiche ne change plus. */
  envoyee: boolean;
  auteur_employee_id: string | null;
  updated_at: string | Date | null;
  touchee: boolean;
}

/** La fiche d'une période, telle quelle, ou neuve si elle n'existe pas encore. */
function laFiche(fiches: FicheDuGeste[], p: PeriodeObjectifs, auteur: string | null): FicheDuGeste {
  const deja = fiches.find((f) => f.annee === p.annee && f.semestre === p.semestre);
  if (deja) return deja;
  const neuve: FicheDuGeste = {
    id: null,
    annee: p.annee,
    semestre: p.semestre,
    contenu: [],
    statuts: {},
    statuts_empreintes: {},
    commentaires_agent: {},
    commentaires_n1: {},
    envoyee: false,
    auteur_employee_id: auteur,
    updated_at: null,
    touchee: false,
  };
  fiches.push(neuve);
  return neuve;
}

const PROPOS = ['statuts', 'statuts_empreintes', 'commentaires_agent', 'commentaires_n1'] as const;

/** Un objectif change de fiche : son statut et ce qui s'en est dit le suivent. */
function transfererLesPropos(id: string, de: FicheDuGeste, vers: FicheDuGeste): void {
  for (const cle of PROPOS) {
    const valeur = de[cle][id];
    if (valeur === undefined) continue;
    (vers[cle] as Record<string, string>)[id] = valeur;
    delete de[cle][id];
  }
}

/** Ce qui se disait d'un objectif retiré de la fiche s'en va avec lui. */
function oublierLesAbsents(f: FicheDuGeste): void {
  const presents = new Set(objectifsDeLaFiche(f.contenu).map((o) => o.id));
  for (const cle of PROPOS) {
    for (const id of Object.keys(f[cle])) if (!presents.has(id)) delete f[cle][id];
  }
}

const memePeriode = (a: PeriodeObjectifs, b: PeriodeObjectifs) =>
  a.annee === b.annee && a.semestre === b.semestre;

/**
 * Les statuts qui valent encore : ceux d'un objectif toujours dans la fiche,
 * dont le texte est celui auquel l'agent a répondu. Réécrit par le n+1
 * depuis, l'objectif est à revoir (`caducs`). Un statut donné avant que les
 * empreintes ne se gardent vaut tel quel.
 */
function statutsEnVigueur(l: LigneFiche): {
  statuts: Record<string, StatutObjectif>;
  caducs: string[];
} {
  const statuts: Record<string, StatutObjectif> = {};
  const caducs: string[] = [];
  for (const o of objectifsDeLaFiche(l.contenu)) {
    const statut = l.statuts[o.id];
    if (!statut) continue;
    const empreinte = l.statuts_empreintes[o.id];
    if (empreinte !== undefined && empreinte !== o.empreinte) caducs.push(o.id);
    else statuts[o.id] = statut;
  }
  return { statuts, caducs };
}

/**
 * Le statut de chaque formation de la fiche : celui de l'APIX Academy,
 * au présent tant que l'auto-évaluation n'est pas envoyée, figé ensuite.
 */
function statutsDeSesFormations(
  l: LigneFiche,
  formations: FormationDeLaFiche[],
): Record<string, StatutObjectif> {
  return statutsDesFormations(objectifsDeLaFiche(l.contenu), l.formations_figees ?? formations);
}

/**
 * Ce que l'agent et le n+1 en lisent. Le brouillon du n+1 n'est qu'à son
 * auteur : un nouveau n+1 évalue sur une page blanche, il ne valide pas les
 * propos de l'ancien. Les objectifs se lisent par échéance, chacun avec la
 * sienne.
 */
function vueFiche(
  l: LigneFiche,
  vue: 'agent' | 'n1',
  formations: FormationDeLaFiche[],
  jours: JoursEvaluation,
  lecteur?: string,
): FicheObjectifs {
  const envoyes = l.commentaires_envoyes_le !== null;
  const validee = l.evaluation_validee_le !== null;
  const voitN1 = validee || (vue === 'n1' && l.evaluateur_employee_id === lecteur);
  const { statuts, caducs } = statutsEnVigueur(l);
  const semestre: Semestre = l.semestre === 1 ? 1 : 2;
  const implicite = dateDEvaluation(l.annee, semestre, jours);
  return {
    annee: l.annee,
    semestre,
    contenu: ranger(avecLesEcheances(avecLesStatuts(l.contenu, statuts), implicite), implicite),
    majLe: iso(l.updated_at)!,
    auteur: l.auteur,
    statuts: { ...statuts, ...statutsDeSesFormations(l, formations) },
    statutsCaducs: caducs,
    formations: l.formations_figees,
    evaluation: {
      commentairesAgent: vue === 'agent' || envoyes ? l.commentaires_agent : {},
      envoyesLe: iso(l.commentaires_envoyes_le),
      commentairesN1: voitN1 ? l.commentaires_n1 : {},
      note: voitN1 ? l.evaluation_note : null,
      valideeLe: iso(l.evaluation_validee_le),
      evaluateur: voitN1 ? l.evaluateur : null,
    },
  };
}

/** Des commentaires, réduits aux objectifs de la fiche — un objectif retiré emporte le sien. */
function garderLesObjectifs(
  f: LigneFiche,
  commentaires: Record<string, string>,
): Record<string, string> {
  const ids = new Set(objectifsDeLaFiche(f.contenu).map((o) => o.id));
  return Object.fromEntries(Object.entries(commentaires).filter(([id]) => ids.has(id)));
}

function exigerNonEnvoyee(f: LigneFiche): void {
  if (f.commentaires_envoyes_le) {
    problem(409, 'objectifs.auto_evaluation_envoyee', 'Votre auto-évaluation est déjà envoyée');
  }
}

function exigerEvaluable(f: LigneFiche): void {
  if (!f.commentaires_envoyes_le) {
    problem(
      409,
      'objectifs.auto_evaluation_attendue',
      'L’agent n’a pas encore envoyé son auto-évaluation',
    );
  }
  if (f.evaluation_validee_le) {
    problem(409, 'objectifs.evaluation_validee', 'Cette évaluation est déjà validée');
  }
}

/** Les objectifs, avec le nom de qui les a fixés. */
const SELECTION = sql`
  SELECT o.id, o.niveau, o.annee, o.diffusion, o.direction_id, o.employee_id, o.nature,
         o.course_id, o.titre, o.description, o.echeance::text AS echeance, o.evaluation,
         o.evalue_le, o.commentaire, o.created_at,
         CASE WHEN pa.id IS NULL THEN NULL ELSE pa.given_name || ' ' || pa.family_name END AS auteur
    FROM objectifs o
    LEFT JOIN employees ea ON ea.id = o.auteur_employee_id
    LEFT JOIN persons pa ON pa.id = ea.person_id`;

@Injectable()
export class ObjectifsService {
  /** L'horloge du serveur — remplaçable dans les tests seulement. */
  horloge: () => Date = () => new Date();

  constructor(
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(AcademySuiviService) private readonly academy: AcademySuiviService,
  ) {}

  private ctx(user: SessionUser) {
    return { tenantId: user.tenantId, userId: user.userId };
  }

  private anneeCourante(): number {
    return this.horloge().getUTCFullYear();
  }

  private aujourdhui(): string {
    return this.horloge().toISOString().slice(0, 10);
  }

  // ———————————————————————————— lectures

  /** « Mes objectifs » : l'APIX (selon la diffusion), la direction, les siens. */
  async mesObjectifs(user: SessionUser, annee?: number): Promise<MesObjectifs> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const cadre = (await directeurGeneral(tx)) === moi || (await dirigeUneDirection(tx, moi));
      const apix = await this.lire(
        tx,
        sql`o.niveau = 'apix' AND o.annee = ${an}
            AND (o.diffusion = 'tous' OR (${cadre} AND o.diffusion = 'directeurs'))`,
      );
      const direction = await this.directionSaufSommet(tx, moi);
      const deLaDirection = direction
        ? await this.lire(
            tx,
            sql`o.niveau = 'direction' AND o.annee = ${an} AND o.direction_id = ${direction.id}`,
          )
        : [];
      const individuels = await this.lire(
        tx,
        sql`o.niveau = 'individuel' AND o.annee = ${an} AND o.employee_id = ${moi}`,
      );
      const progression = await this.progression(tx, [moi]);
      const jours = await this.joursEvaluation(tx);
      return {
        annee: an,
        fiches: await this.lireFiches(tx, moi, 'agent', formationsDe(progression.get(moi)), jours),
        formations: formationsDe(progression.get(moi)),
        apix: apix.map((o) => this.vue(o)),
        direction: direction
          ? { ...direction, objectifs: deLaDirection.map((o) => this.vue(o)) }
          : null,
        individuels: individuels.map((o) => this.vue(o, progression.get(moi))),
        joursEvaluation: jours,
      };
    });
  }

  /** « Suivi & Évaluation » : les directs, et où en sont leurs objectifs. */
  async suiviEquipe(user: SessionUser, annee?: number): Promise<SuiviEquipe> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const membres = await this.directs(tx, moi, true);
      const ids = membres.map((m) => m.id);
      const objectifs = ids.length
        ? await this.lire(
            tx,
            sql`o.niveau = 'individuel' AND o.annee = ${an} AND o.employee_id IN ${ids}`,
          )
        : [];
      const progression = await this.progression(tx, ids);
      const aEvaluer = new Map<string, number>();
      if (ids.length) {
        const { rows } = await tx.execute<{ employee_id: string; n: number }>(sql`
          SELECT employee_id, count(*)::int AS n FROM objectifs_fiches
           WHERE employee_id IN ${ids}
             AND commentaires_envoyes_le IS NOT NULL AND evaluation_validee_le IS NULL
           GROUP BY employee_id`);
        for (const r of rows) aEvaluer.set(r.employee_id, r.n);
      }
      return {
        annee: an,
        membres: membres.map((m) =>
          this.membre(
            m,
            objectifs
              .filter((o) => o.employee_id === m.id)
              .map((o) => this.vue(o, progression.get(m.id))),
            aEvaluer.get(m.id) ?? 0,
          ),
        ),
      };
    });
  }

  async fiche(user: SessionUser, employeeId: string, annee?: number): Promise<FicheSuivi> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const membre = (await this.directs(tx, moi, true)).find((m) => m.id === employeeId);
      if (!membre) {
        problem(404, 'objectifs.hors_equipe', 'Cet agent ne fait pas partie de votre équipe');
      }
      const progression = await this.progression(tx, [membre.id]);
      const objectifs = (
        await this.lire(
          tx,
          sql`o.niveau = 'individuel' AND o.annee = ${an} AND o.employee_id = ${membre.id}`,
        )
      ).map((o) => this.vue(o, progression.get(membre.id)));
      const jours = await this.joursEvaluation(tx);
      const fiches = await this.lireFiches(
        tx,
        membre.id,
        'n1',
        formationsDe(progression.get(membre.id)),
        jours,
        moi,
      );
      const aEvaluer = fiches.filter(
        (f) => f.evaluation.envoyesLe && !f.evaluation.valideeLe,
      ).length;
      return {
        annee: an,
        membre: this.membre(membre, objectifs, aEvaluer),
        objectifs,
        fiches,
        formations: formationsDe(progression.get(membre.id)),
        joursEvaluation: jours,
      };
    });
  }

  /**
   * Le n+1 fixe des objectifs à son direct, chacun avec son échéance, sans
   * choisir le semestre : un objectif compte pour la première évaluation qui
   * tombe le jour de son échéance ou après (ADR-0055). Chaque fiche qui en
   * reçoit les range par échéance, et l'agent en est prévenu.
   */
  async fixerObjectifs(
    user: SessionUser,
    employeeId: string,
    input: FixerObjectifsInput,
  ): Promise<ObjectifsFixes> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      if (!(await this.directs(tx, moi)).some((m) => m.id === employeeId)) {
        problem(404, 'objectifs.hors_equipe', 'Cet agent ne fait pas partie de votre équipe');
      }
      const jours = await this.joursEvaluation(tx);
      const fiches = await this.fichesDuGeste(tx, employeeId);
      for (const o of input.objectifs) {
        this.exigerEcheancePossible(o.echeance, jours);
        const cible = this.ficheQuiRecoit(
          fiches,
          periodeDeLEcheance(o.echeance, jours),
          moi,
          jours,
        );
        cible.contenu = [
          ...cible.contenu,
          {
            id: uuidv7(),
            type: 'checkListItem',
            props: { echeance: o.echeance },
            // Un objectif tient sur une ligne.
            content: [{ type: 'text', text: o.texte.replace(/\s+/g, ' '), styles: {} }],
            children: [],
          },
        ];
        cible.touchee = true;
      }
      const ecrites = await this.ecrireLesFiches(tx, user, employeeId, fiches, jours, moi);
      await this.prevenirDesFiches(tx, user, employeeId, moi, ecrites);
      return { periodes: [...ecrites.keys()].map(({ annee, semestre }) => ({ annee, semestre })) };
    });
  }

  /**
   * Le n+1 enregistre la fiche d'objectifs de son direct pour un semestre,
   * d'un clic sur « Enregistrer » (ADR-0051). Les objectifs s'y rangent par
   * échéance ; celui dont l'échéance change de période part dans la fiche de
   * sa nouvelle évaluation, avec son statut et ce qui s'en est dit
   * (ADR-0055). Chaque enregistrement qui change une fiche prévient l'agent ;
   * la dernière notification remplace les précédentes. Une fiche renvoyée
   * telle quelle ne s'écrit pas.
   */
  async enregistrerFiche(
    user: SessionUser,
    employeeId: string,
    input: EnregistrerFicheObjectifsInput,
  ): Promise<FicheEnregistree> {
    const an = input.annee ?? this.anneeCourante();
    const contenu = assainir(input.contenu) as Bloc[];
    if (JSON.stringify(contenu).length > FICHE_OBJECTIFS_MAX) {
      problem(400, 'objectifs.fiche_trop_longue', 'La fiche est trop longue pour être enregistrée');
    }
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const membre = (await this.directs(tx, moi)).find((m) => m.id === employeeId);
      if (!membre) {
        problem(404, 'objectifs.hors_equipe', 'Cet agent ne fait pas partie de votre équipe');
      }
      const jours = await this.joursEvaluation(tx);
      const fiches = await this.fichesDuGeste(tx, employeeId);
      const ici = laFiche(fiches, { annee: an, semestre: input.semestre }, moi);
      // L'agent a rendu compte de ces objectifs : ils ne changent plus.
      if (ici.envoyee) {
        problem(
          409,
          'objectifs.fiche_verrouillee',
          'L’agent a envoyé son auto-évaluation : ces objectifs ne changent plus',
        );
      }
      const implicite = dateDEvaluation(an, input.semestre, jours);
      const avant = new Map<string, Bloc>();
      for (const b of ici.contenu) {
        if (b.type === 'checkListItem' && typeof b.id === 'string') avant.set(b.id, b);
      }

      const gardes: Bloc[] = [];
      const partants: { bloc: Bloc; vers: PeriodeObjectifs }[] = [];
      for (const brut of contenu) {
        if (brut.type !== 'checkListItem') {
          gardes.push(brut);
          continue;
        }
        if (caseVide(brut)) continue;
        const b = typeof brut.id === 'string' && brut.id ? brut : { ...brut, id: uuidv7() };
        const ancien = avant.get(String(b.id));
        const voulue = echeanceDuBloc(b);
        // L'échéance ne change pas : celle que la case avait, ou aucune à elle
        // (celle de la fiche, que la lecture lui prête).
        if (voulue === null || (ancien && voulue === (echeanceDuBloc(ancien) ?? implicite))) {
          gardes.push(caseAGarder(b, ancien ? echeanceDuBloc(ancien) : null));
          continue;
        }
        // Une évaluation passée garde ses objectifs : on ne repousse pas une
        // échéance pour en sortir un.
        if (ancien && implicite < this.aujourdhui()) {
          problem(
            409,
            'objectifs.evaluation_passee',
            `L’évaluation du ${dateEnLettres(implicite)} est passée : les échéances de ses objectifs ne changent plus`,
          );
        }
        this.exigerEcheancePossible(voulue, jours);
        const vers = periodeDeLEcheance(voulue, jours);
        if (memePeriode(vers, ici)) gardes.push(caseAGarder(b, voulue));
        else partants.push({ bloc: caseAGarder(b, voulue), vers });
      }

      for (const { bloc, vers } of partants) {
        const cible = this.ficheQuiRecoit(fiches, vers, moi, jours);
        cible.contenu = [...cible.contenu, bloc];
        transfererLesPropos(String(bloc.id), ici, cible);
        cible.touchee = true;
      }
      ici.contenu = gardes;
      oublierLesAbsents(ici);
      ici.touchee = true;

      const ecrites = await this.ecrireLesFiches(tx, user, employeeId, fiches, jours, moi);
      await this.prevenirDesFiches(tx, user, employeeId, moi, ecrites);
      return {
        majLe: ecrites.get(ici) ?? iso(ici.updated_at)!,
        periodes: [...ecrites.keys()].map(({ annee, semestre }) => ({ annee, semestre })),
      };
    });
  }

  /**
   * Les fiches de l'agent, verrouillées le temps du geste. Un geste à la fois
   * par agent : deux enregistrements simultanés ne créent pas deux fiches du
   * même semestre.
   */
  private async fichesDuGeste(tx: Tx, employeeId: string): Promise<FicheDuGeste[]> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`objectifs:fiches:${employeeId}`}))`,
    );
    const { rows } = await tx.execute<Omit<FicheDuGeste, 'touchee'>>(sql`
      SELECT id, annee, semestre, contenu, statuts, statuts_empreintes,
             commentaires_agent, commentaires_n1,
             commentaires_envoyes_le IS NOT NULL AS envoyee, auteur_employee_id, updated_at
        FROM objectifs_fiches
       WHERE employee_id = ${employeeId}
       ORDER BY annee, semestre
         FOR UPDATE`);
    return rows.map((r) => ({
      ...r,
      semestre: r.semestre === 1 ? 1 : 2,
      contenu: Array.isArray(r.contenu) ? r.contenu : [],
      touchee: false,
    }));
  }

  /**
   * La fiche où va un objectif fixé ou déplacé. Envoyée, elle ne reçoit plus
   * rien : l'échéance se choisit après sa date d'évaluation.
   */
  private ficheQuiRecoit(
    fiches: FicheDuGeste[],
    vers: PeriodeObjectifs,
    auteur: string,
    jours: JoursEvaluation,
  ): FicheDuGeste {
    const cible = laFiche(fiches, vers, auteur);
    if (cible.envoyee) {
      problem(
        409,
        'objectifs.fiche_verrouillee',
        `L’agent a envoyé son auto-évaluation ${duSemestre(vers.semestre, vers.annee)} : choisissez une échéance après le ${dateEnLettres(dateDEvaluation(vers.annee, vers.semestre, jours))}`,
      );
    }
    return cible;
  }

  /**
   * Une échéance se fixe à partir d'aujourd'hui, jusqu'à la dernière
   * évaluation de l'année suivante : la page du n+1 ne va pas au-delà.
   */
  private exigerEcheancePossible(echeance: string, jours: JoursEvaluation): void {
    if (echeance < this.aujourdhui()) {
      problem(
        422,
        'objectifs.echeance_passee',
        `L’échéance du ${dateEnLettres(echeance)} est déjà passée`,
      );
    }
    const horizon = dateDEvaluation(this.anneeCourante() + 1, 2, jours);
    if (echeance > horizon) {
      problem(
        422,
        'objectifs.echeance_trop_lointaine',
        `Une échéance se fixe au plus tard le ${dateEnLettres(horizon)}`,
      );
    }
  }

  /**
   * Écrit les fiches que le geste a touchées, chacune rangée par échéance.
   * Une fiche que rien n'a changé ne s'écrit pas. `auteur` : qui signe la
   * mise à jour (`null` : la fiche garde le sien). Rend les fiches écrites,
   * avec l'heure de leur écriture, dans l'ordre du temps.
   */
  private async ecrireLesFiches(
    tx: Tx,
    user: SessionUser,
    employeeId: string,
    fiches: FicheDuGeste[],
    jours: JoursEvaluation,
    auteur: string | null,
  ): Promise<Map<FicheDuGeste, string>> {
    const ecrites = new Map<FicheDuGeste, string>();
    const parPeriode = [...fiches].sort((a, b) => a.annee - b.annee || a.semestre - b.semestre);
    for (const f of parPeriode) {
      if (!f.touchee) continue;
      f.contenu = ranger(f.contenu, dateDEvaluation(f.annee, f.semestre, jours));
      const contenu = JSON.stringify(f.contenu);
      if (contenu.length > FICHE_OBJECTIFS_MAX) {
        problem(
          400,
          'objectifs.fiche_trop_longue',
          'La fiche est trop longue pour être enregistrée',
        );
      }
      const statuts = JSON.stringify(f.statuts);
      const empreintes = JSON.stringify(f.statuts_empreintes);
      const agent = JSON.stringify(f.commentaires_agent);
      const n1 = JSON.stringify(f.commentaires_n1);
      if (f.id === null) {
        const { rows } = await tx.execute<{ updated_at: string | Date }>(sql`
          INSERT INTO objectifs_fiches
                 (id, tenant_id, employee_id, annee, semestre, contenu, statuts,
                  statuts_empreintes, commentaires_agent, commentaires_n1, auteur_employee_id)
          VALUES (${uuidv7()}, ${user.tenantId}, ${employeeId}, ${f.annee}, ${f.semestre},
                  ${contenu}::jsonb, ${statuts}::jsonb, ${empreintes}::jsonb, ${agent}::jsonb,
                  ${n1}::jsonb, ${auteur ?? f.auteur_employee_id})
          RETURNING updated_at`);
        ecrites.set(f, iso(rows[0]!.updated_at)!);
        continue;
      }
      const { rows } = await tx.execute<{ updated_at: string | Date }>(sql`
        UPDATE objectifs_fiches
           SET contenu = ${contenu}::jsonb, statuts = ${statuts}::jsonb,
               statuts_empreintes = ${empreintes}::jsonb,
               commentaires_agent = ${agent}::jsonb, commentaires_n1 = ${n1}::jsonb,
               auteur_employee_id = ${auteur ? sql`${auteur}` : sql`auteur_employee_id`},
               updated_at = now()
         WHERE id = ${f.id}
           AND (contenu, statuts, statuts_empreintes, commentaires_agent, commentaires_n1)
               IS DISTINCT FROM (${contenu}::jsonb, ${statuts}::jsonb, ${empreintes}::jsonb,
                                 ${agent}::jsonb, ${n1}::jsonb)
        RETURNING updated_at`);
      if (rows[0]) ecrites.set(f, iso(rows[0].updated_at)!);
    }
    return ecrites;
  }

  /**
   * Chaque fiche écrite qui porte un objectif prévient l'agent : un
   * commentaire posé seul n'annonce rien. Une notification par
   * enregistrement, et seule la dernière d'une fiche reste dans la boîte.
   */
  private async prevenirDesFiches(
    tx: Tx,
    user: SessionUser,
    employeeId: string,
    moi: string,
    ecrites: Map<FicheDuGeste, string>,
  ): Promise<void> {
    const aPrevenir = [...ecrites].filter(([f]) => objectifsDeLaFiche(f.contenu).length > 0);
    if (aPrevenir.length === 0) return;
    const compte = await this.compteDe(tx, employeeId);
    if (!compte) return;
    const auteur = (await this.nomDe(tx, moi)) || 'Votre n+1';
    for (const [f, majLe] of aPrevenir) {
      const sujet = `objectifs:fiche:${employeeId}:${f.annee}:${f.semestre}:`;
      const { rows: deja } = await tx.execute(sql`
        SELECT 1 FROM notifications
         WHERE recipient_user_id = ${compte} AND dedupe_key LIKE ${`${sujet}%`} LIMIT 1`);
      await notifier(tx, user.tenantId, compte, {
        type: 'objectif',
        sujet: 'objectifs',
        title: `${auteur} a ${deja.length > 0 ? 'mis à jour' : 'fixé'} vos objectifs ${duSemestre(f.semestre, f.annee)}`,
        link: '/moi/objectifs',
        dedupeKey: `${sujet}${majLe}`,
        remplace: sujet,
      });
    }
  }

  /**
   * Les fiches d'un agent, les plus récentes d'abord — sans les fiches vides.
   * Les cases de la fiche disent où l'agent en est. Chacun ne voit de
   * l'autre que ce qui est envoyé : le n+1, les commentaires de l'agent une
   * fois son auto-évaluation envoyée ; l'agent, ceux du n+1 et la note une
   * fois validés.
   */
  private async lireFiches(
    tx: Tx,
    employeeId: string,
    vue: 'agent' | 'n1',
    formations: FormationDeLaFiche[],
    jours: JoursEvaluation,
    lecteur?: string,
  ): Promise<FicheObjectifs[]> {
    const { rows } = await tx.execute<LigneFiche>(sql`
      ${SELECTION_FICHE}
       WHERE f.employee_id = ${employeeId}
       ORDER BY f.annee DESC, f.semestre DESC`);
    return rows
      .filter((l) => ficheRemplie(l.contenu))
      .map((l) => vueFiche(l, vue, formations, jours, lecteur));
  }

  /** Une fiche, verrouillée le temps du geste — 404 si elle n'existe pas. */
  private async uneFiche(
    tx: Tx,
    employeeId: string,
    annee: number,
    semestre: number,
  ): Promise<LigneFiche> {
    const { rows } = await tx.execute<LigneFiche>(sql`
      ${SELECTION_FICHE}
       WHERE f.employee_id = ${employeeId} AND f.annee = ${annee} AND f.semestre = ${semestre}
       FOR UPDATE OF f`);
    const ligne = rows[0];
    if (!ligne || !ficheRemplie(ligne.contenu)) {
      problem(404, 'objectifs.fiche_introuvable', 'Aucun objectif n’a été fixé pour ce semestre');
    }
    return ligne;
  }

  private async nomDe(tx: Tx, employeeId: string): Promise<string> {
    const { rows } = await tx.execute<{ nom: string }>(sql`
      SELECT p.given_name || ' ' || p.family_name AS nom
        FROM employees e JOIN persons p ON p.id = e.person_id WHERE e.id = ${employeeId}`);
    return rows[0]?.nom ?? '';
  }

  // ———————————————————————————— ce que l'agent en fait

  /**
   * L'agent dit où en est un objectif — atteint, partiellement, non atteint —
   * ou revient sur son choix (`null`). Son n+1 le voit à mesure. Son
   * auto-évaluation envoyée, plus rien ne bouge.
   */
  async statuer(
    user: SessionUser,
    annee: number,
    semestre: number,
    input: StatutObjectifInput,
  ): Promise<{ statuts: Record<string, StatutObjectif> }> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const f = await this.uneFiche(tx, moi, annee, semestre);
      exigerNonEnvoyee(f);
      const objectif = objectifsDeLaFiche(f.contenu).find((o) => o.id === input.id);
      if (!objectif) {
        problem(422, 'objectifs.objectif_inconnu', 'Cet objectif n’est pas dans la fiche');
      }
      if (objectif.formation) {
        problem(
          422,
          'objectifs.statut_de_formation',
          'Le statut d’une formation vient de l’APIX Academy',
        );
      }
      // L'agent répond au texte qu'il a sous les yeux : réécrit entre-temps
      // par son n+1, l'objectif se relit avant d'être évalué.
      if (input.empreinte !== undefined && input.empreinte !== objectif.empreinte) {
        problem(
          409,
          'objectifs.objectif_modifie',
          'Votre N+1 vient de modifier cet objectif',
          'Relisez-le, puis dites où vous en êtes.',
        );
      }
      const { rows } = await tx.execute<LigneFiche>(sql`
        UPDATE objectifs_fiches
           SET ${
             input.statut
               ? sql`statuts = statuts || jsonb_build_object(${input.id}::text, ${input.statut}::text),
                     statuts_empreintes = statuts_empreintes
                       || jsonb_build_object(${input.id}::text, ${objectif.empreinte}::text)`
               : sql`statuts = statuts - ${input.id}::text,
                     statuts_empreintes = statuts_empreintes - ${input.id}::text`
           }
         WHERE id = ${f.id}
        RETURNING contenu, statuts, statuts_empreintes, formations_figees`);
      const formations = formationsDe((await this.progression(tx, [moi])).get(moi));
      return {
        statuts: {
          ...statutsEnVigueur(rows[0]!).statuts,
          ...statutsDeSesFormations(rows[0]!, formations),
        },
      };
    });
  }

  /** L'agent enregistre ses commentaires, au brouillon : son n+1 ne les voit pas encore. */
  async enregistrerCommentaires(
    user: SessionUser,
    annee: number,
    semestre: number,
    input: CommentairesAgentInput,
  ): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const f = await this.uneFiche(tx, moi, annee, semestre);
      exigerNonEnvoyee(f);
      await tx.execute(sql`
        UPDATE objectifs_fiches
           SET commentaires_agent = ${JSON.stringify(garderLesObjectifs(f, input.commentaires))}::jsonb
         WHERE id = ${f.id}`);
    });
  }

  /**
   * L'agent envoie son auto-évaluation à son n+1 : chaque case avec son
   * statut et son commentaire, atteinte ou non ; chaque formation avec le
   * statut que l'Academy lui donne ce jour-là. Les objectifs, les statuts et
   * les commentaires ne changent plus ; le n+1 en est prévenu.
   */
  async envoyerCommentaires(user: SessionUser, annee: number, semestre: number): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const f = await this.uneFiche(tx, moi, annee, semestre);
      exigerNonEnvoyee(f);
      const objectifs = objectifsDeLaFiche(f.contenu);
      // Les cases à cocher et les formations sont des objectifs : une fiche en
      // titres, en puces ou en tableau n'a rien à évaluer, et se verrouillerait
      // vide.
      if (objectifs.length === 0) {
        problem(422, 'objectifs.sans_objectif', 'Cette fiche n’a encore aucun objectif à évaluer');
      }
      // Un statut donné à un texte que le n+1 a réécrit depuis ne compte pas.
      // Une formation a le sien, celui de l'Academy ; la commenter est libre.
      const { statuts } = statutsEnVigueur(f);
      const restants = objectifs.filter(
        (o) => !o.formation && (!statuts[o.id] || !f.commentaires_agent[o.id]?.trim()),
      ).length;
      if (restants > 0) {
        problem(
          422,
          'objectifs.auto_evaluation_incomplete',
          restants > 1
            ? `${restants} objectifs attendent encore leur statut ou votre commentaire`
            : 'Un objectif attend encore son statut ou votre commentaire',
        );
      }
      // Les formations de la fiche se figent avec elle : relue plus tard,
      // elle dit où en était l'agent quand il l'a envoyée.
      const cites = new Set(formationsDeLaFiche(f.contenu));
      const figees = formationsDe((await this.progression(tx, [moi])).get(moi)).filter((x) =>
        cites.has(x.courseId),
      );
      // Elle part à quelqu'un : sans N+1, elle ne s'envoie pas.
      const { rows } = await tx.execute<{ n1: string | null }>(sql`
        SELECT manager_employee_id AS n1 FROM employees
         WHERE id = ${moi} AND id IS DISTINCT FROM ${DG}`);
      if (!rows[0]?.n1) {
        problem(
          422,
          'objectifs.sans_n1',
          'Votre auto-évaluation s’envoie à votre N+1 : vous n’en avez pas pour l’instant',
        );
      }
      await tx.execute(sql`
        UPDATE objectifs_fiches
           SET commentaires_envoyes_le = now(), formations_figees = ${JSON.stringify(figees)}::jsonb
         WHERE id = ${f.id}`);
      await reconcilierLesEvaluations(tx, moi);
    });
  }

  // ———————————————————————————— ce que le n+1 en dit

  /**
   * Le n+1 commente à son tour, sous chaque objectif, et donne la note — au
   * brouillon, une fois l'auto-évaluation de l'agent reçue.
   */
  async enregistrerEvaluation(
    user: SessionUser,
    employeeId: string,
    annee: number,
    semestre: number,
    input: EvaluationN1Input,
  ): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      await this.exigerSonN1(tx, moi, employeeId, true);
      const f = await this.uneFiche(tx, employeeId, annee, semestre);
      exigerEvaluable(f);
      await tx.execute(sql`
        UPDATE objectifs_fiches
           SET commentaires_n1 = ${JSON.stringify(garderLesObjectifs(f, input.commentaires))}::jsonb,
               evaluation_note = ${input.note},
               evaluateur_employee_id = ${moi}
         WHERE id = ${f.id}`);
    });
  }

  /** Le n+1 valide l'évaluation : la note est donnée ; l'agent en est prévenu et la lit. */
  async validerEvaluation(
    user: SessionUser,
    employeeId: string,
    annee: number,
    semestre: number,
  ): Promise<void> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      await this.exigerSonN1(tx, moi, employeeId, true);
      const f = await this.uneFiche(tx, employeeId, annee, semestre);
      exigerEvaluable(f);
      // La note d'un autre (l'ancien n+1) ne se valide pas : la sienne seule.
      if (!f.evaluation_note || f.evaluateur_employee_id !== moi) {
        problem(422, 'objectifs.evaluation_sans_note', 'Donnez l’appréciation globale');
      }
      await tx.execute(sql`
        UPDATE objectifs_fiches
           SET evaluation_validee_le = now(), evaluateur_employee_id = ${moi}
         WHERE id = ${f.id}`);
      await retirerLesAppels(tx, prefixeEvaluation(employeeId, annee, semestre));
      const compte = await this.compteDe(tx, employeeId);
      if (compte) {
        await notifier(tx, user.tenantId, compte, {
          type: 'objectif',
          sujet: 'objectifs',
          title: `${await this.nomDe(tx, moi)} a évalué vos objectifs ${duSemestre(semestre, annee)}`,
          link: '/moi/objectifs',
          dedupeKey: `objectifs:evaluation:${employeeId}:${annee}:${semestre}`,
        });
      }
    });
  }

  /**
   * Les évaluations validées d'un agent, la plus récente d'abord — ce que son
   * dossier en garde. L'agent voit les siennes ; le directeur du Capital
   * Humain, celles de tous. Consulter les dossiers n'y suffit pas : une note
   * ne se lit pas comme une adresse.
   */
  async evaluationsDe(user: SessionUser, employeeId: string): Promise<EvaluationValidee[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      if (!user.dirigeLaDCH && (await employeActif(tx, user.userId)) !== employeeId) {
        problem(403, 'objectifs.dossier_interdit', 'Ces évaluations ne sont pas les vôtres');
      }
      const { rows } = await tx.execute<{
        annee: number;
        semestre: number;
        manager: string | null;
        note: NoteGlobale;
        validee_le: string | Date;
      }>(sql`
        SELECT f.annee, f.semestre, f.evaluation_note AS note, f.evaluation_validee_le AS validee_le,
               CASE WHEN p.id IS NULL THEN NULL ELSE p.given_name || ' ' || p.family_name END AS manager
          FROM objectifs_fiches f
          LEFT JOIN employees e ON e.id = f.evaluateur_employee_id
          LEFT JOIN persons p ON p.id = e.person_id
         WHERE f.employee_id = ${employeeId} AND f.evaluation_validee_le IS NOT NULL
         ORDER BY f.annee DESC, f.semestre DESC`);
      return rows.map((r) => ({
        annee: Number(r.annee),
        semestre: r.semestre === 1 ? 1 : 2,
        manager: r.manager,
        note: r.note,
        valideeLe: iso(r.validee_le)!,
      }));
    });
  }

  /** Les formations publiées qu'un n+1 peut donner à suivre. */
  async formationsProposables(user: SessionUser): Promise<FormationProposable[]> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const { rows } = await tx.execute<{ id: string; title: string }>(sql`
        SELECT c.id, c.title
          FROM academy_courses c
         WHERE c.published_at IS NOT NULL
           AND EXISTS (SELECT 1 FROM academy_lessons l JOIN academy_modules m ON m.id = l.module_id
                        WHERE l.course_id = c.id AND l.video_status = 'prete')
         ORDER BY c.title`);
      return rows;
    });
  }

  /** « Objectifs de l'APIX » : ce que le directeur général fixe. */
  async objectifsAPIX(user: SessionUser, annee?: number): Promise<ObjectifsAPIX> {
    const an = annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      await this.exigerDG(tx, user);
      const orientations = await this.lire(tx, sql`o.niveau = 'apix' AND o.annee = ${an}`);
      const { rows: directions } = await tx.execute<{
        id: string;
        name: string;
        directeur: string | null;
      }>(sql`
        SELECT o.id, o.name,
               CASE WHEN p.id IS NULL THEN NULL ELSE p.given_name || ' ' || p.family_name END AS directeur
          FROM org_units o
          LEFT JOIN employees e ON e.id = o.manager_employee_id AND e.status = 'active'
          LEFT JOIN persons p ON p.id = e.person_id
         WHERE o.unit_type = 'direction' AND o.deleted_at IS NULL
           AND o.id IS DISTINCT FROM ${SOMMET}
         ORDER BY o.name`);
      const objectifs = await this.lire(tx, sql`o.niveau = 'direction' AND o.annee = ${an}`);
      return {
        annee: an,
        orientations: orientations.map((o) => this.vue(o)),
        directions: directions.map((d) => ({
          id: d.id,
          nom: d.name,
          directeur: d.directeur,
          objectifs: objectifs.filter((o) => o.direction_id === d.id).map((o) => this.vue(o)),
        })),
      };
    });
  }

  // Les dates d'évaluation : les notes de A à D se donnent ces jours-là.

  /**
   * Les deux dates d'évaluation, un jour et un mois qui reviennent chaque
   * année, posés sur l'année de la prochaine : l'année en cours tant qu'une
   * de ses dates reste à venir, la suivante ensuite.
   */
  async datesEvaluation(user: SessionUser): Promise<DatesEvaluation> {
    return this.db.withTenant(this.ctx(user), async (tx) =>
      this.vueDesDates(user, await this.joursEvaluation(tx)),
    );
  }

  /**
   * Fixe les deux jours d'évaluation, sans année : ils valent cette année
   * comme les suivantes. Ce qui est passé reste passé. Seule la personne qui
   * dirige la DCH les fixe ; le 1er semestre s'évalue avant le 2nd.
   */
  async fixerDatesEvaluation(
    user: SessionUser,
    input: DatesEvaluationInput,
  ): Promise<DatesEvaluation> {
    if (!user.dirigeLaDCH) {
      problem(
        403,
        'objectifs.dates_reservees',
        'Seule la personne qui dirige la DCH fixe les dates d’évaluation',
      );
    }
    if (input.semestre1 >= input.semestre2) {
      problem(
        422,
        'objectifs.dates_dans_l_ordre',
        'L’évaluation du 1er semestre vient avant celle du 2nd',
      );
    }
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const voulus = [input.semestre1, input.semestre2] as const;
      const actuels = await this.joursEvaluation(tx);
      if (voulus.every((j, i) => j === actuels[i])) return this.vueDesDates(user, actuels);
      const [m1, j1] = input.semestre1.split('-').map(Number);
      const [m2, j2] = input.semestre2.split('-').map(Number);
      await tx.execute(sql`
        INSERT INTO objective_review_schedule (id, tenant_id, s1_month, s1_day, s2_month, s2_day)
        VALUES (${uuidv7()}, ${user.tenantId}, ${m1}, ${j1}, ${m2}, ${j2})
        ON CONFLICT (tenant_id) DO UPDATE
           SET s1_month = EXCLUDED.s1_month, s1_day = EXCLUDED.s1_day,
               s2_month = EXCLUDED.s2_month, s2_day = EXCLUDED.s2_day,
               updated_at = now()`);
      await this.suivreLesNouvellesDates(tx, user, voulus);
      return this.vueDesDates(user, voulus);
    });
  }

  /**
   * Les dates d'évaluation ont changé : chaque objectif encore à venir compte
   * désormais pour la première évaluation qui tombe le jour de son échéance
   * ou après, et passe dans sa fiche avec son statut et ce qui s'en est dit.
   * Ce qui est passé reste où il est ; une fiche envoyée ne perd ni ne reçoit
   * rien. Personne n'est prévenu : aucun objectif ne change.
   */
  private async suivreLesNouvellesDates(
    tx: Tx,
    user: SessionUser,
    jours: JoursEvaluation,
  ): Promise<void> {
    const aujourdhui = this.aujourdhui();
    const { rows } = await tx.execute<{ employee_id: string }>(sql`
      SELECT DISTINCT employee_id FROM objectifs_fiches
       WHERE commentaires_envoyes_le IS NULL
         AND jsonb_path_exists(contenu, '$[*] ? (@.type == "checkListItem").props.echeance')`);
    for (const { employee_id: employeeId } of rows) {
      const fiches = await this.fichesDuGeste(tx, employeeId);
      for (const de of [...fiches]) {
        if (de.envoyee) continue;
        for (const b of [...de.contenu]) {
          const echeance = b.type === 'checkListItem' ? echeanceDuBloc(b) : null;
          if (!echeance || echeance < aujourdhui) continue;
          const vers = periodeDeLEcheance(echeance, jours);
          if (memePeriode(vers, de)) continue;
          const cible = laFiche(fiches, vers, de.auteur_employee_id);
          if (cible.envoyee) continue;
          de.contenu = de.contenu.filter((x) => x !== b);
          cible.contenu = [...cible.contenu, b];
          transfererLesPropos(String(b.id), de, cible);
          de.touchee = true;
          cible.touchee = true;
        }
      }
      await this.ecrireLesFiches(tx, user, employeeId, fiches, jours, null);
    }
  }

  /** Les jours d'évaluation, « MM-JJ » : ceux par défaut tant que personne n'en a fixé. */
  private async joursEvaluation(tx: Tx): Promise<JoursEvaluation> {
    const { rows } = await tx.execute<{
      s1_month: number;
      s1_day: number;
      s2_month: number;
      s2_day: number;
    }>(sql`SELECT s1_month, s1_day, s2_month, s2_day FROM objective_review_schedule`);
    const r = rows[0];
    if (!r) return JOURS_D_EVALUATION_PAR_DEFAUT;
    const mmjj = (mois: number, j: number) =>
      `${String(mois).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
    return [mmjj(r.s1_month, r.s1_day), mmjj(r.s2_month, r.s2_day)];
  }

  private vueDesDates(user: SessionUser, jours: JoursEvaluation): DatesEvaluation {
    const aujourdhui = this.aujourdhui();
    let annee = this.anneeCourante();
    if (jours.every((j) => `${annee}-${j}` < aujourdhui)) annee += 1;
    return {
      annee,
      dates: jours.map((jour, i) => ({
        semestre: (i + 1) as Semestre,
        jour,
        date: `${annee}-${jour}`,
      })),
      modifiables: Boolean(user.dirigeLaDCH),
    };
  }

  // ———————————————————————————— écritures

  async creer(user: SessionUser, input: CreerObjectifInput): Promise<ObjectifView> {
    const an = input.annee ?? this.anneeCourante();
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      let titre = input.titre?.trim() ?? '';
      if (input.niveau === 'apix' || input.niveau === 'direction') {
        await this.exigerDG(tx, user);
      }
      if (input.niveau === 'direction') {
        const { rows } = await tx.execute(sql`
          SELECT 1 FROM org_units
           WHERE id = ${input.directionId} AND unit_type = 'direction' AND deleted_at IS NULL
             AND id IS DISTINCT FROM ${SOMMET}`);
        if (rows.length === 0) {
          problem(422, 'objectifs.direction_inconnue', 'Cette direction n’existe pas');
        }
      }
      if (input.niveau === 'individuel') {
        await this.exigerSonN1(tx, moi, input.employeeId!);
        if (input.nature === 'formation') {
          const { rows } = await tx.execute<{ title: string }>(sql`
            SELECT title FROM academy_courses
             WHERE id = ${input.courseId} AND published_at IS NOT NULL`);
          if (!rows[0]) {
            problem(422, 'objectifs.formation_inconnue', 'Cette formation n’est pas au catalogue');
          }
          titre = rows[0].title;
          const { rows: deja } = await tx.execute(sql`
            SELECT 1 FROM objectifs
             WHERE employee_id = ${input.employeeId} AND course_id = ${input.courseId}
               AND annee = ${an}`);
          if (deja.length > 0) {
            problem(409, 'objectifs.formation_deja_fixee', 'Cette formation lui est déjà fixée');
          }
        }
      }

      const id = uuidv7();
      await tx.execute(sql`
        INSERT INTO objectifs (id, tenant_id, niveau, annee, diffusion, direction_id, employee_id,
                               nature, course_id, titre, description, echeance, auteur_employee_id)
        VALUES (${id}, ${user.tenantId}, ${input.niveau}, ${an},
                ${input.niveau === 'apix' ? input.diffusion! : null},
                ${input.niveau === 'direction' ? input.directionId! : null},
                ${input.niveau === 'individuel' ? input.employeeId! : null},
                ${input.nature}, ${input.nature === 'formation' ? input.courseId! : null},
                ${titre}, ${input.description?.trim() || null}, ${input.echeance ?? null}, ${moi})`);

      const cree = await this.un(tx, id);
      await this.prevenirDeLaCreation(tx, user, moi, cree);
      const progression =
        cree.employee_id !== null ? await this.progression(tx, [cree.employee_id]) : undefined;
      return this.vue(cree, cree.employee_id ? progression?.get(cree.employee_id) : undefined);
    });
  }

  async modifier(
    user: SessionUser,
    id: string,
    input: ModifierObjectifInput,
  ): Promise<ObjectifView> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const o = await this.un(tx, id);
      await this.exigerLaMain(tx, user, moi, o);
      if (input.titre !== undefined && o.nature === 'formation') {
        problem(422, 'objectifs.titre_formation', 'Une formation garde le titre du catalogue');
      }
      if (input.diffusion !== undefined && o.niveau !== 'apix') {
        problem(422, 'objectifs.diffusion', 'Seules les orientations de l’APIX se diffusent');
      }
      const champs: SQL[] = [sql`updated_at = now()`];
      if (input.titre !== undefined) champs.push(sql`titre = ${input.titre.trim()}`);
      if (input.description !== undefined) {
        champs.push(sql`description = ${input.description?.trim() || null}`);
      }
      if (input.echeance !== undefined) champs.push(sql`echeance = ${input.echeance}`);
      if (input.diffusion !== undefined) champs.push(sql`diffusion = ${input.diffusion}`);
      await tx.execute(sql`UPDATE objectifs SET ${sql.join(champs, sql`, `)} WHERE id = ${id}`);
      const apres = await this.un(tx, id);
      const progression = apres.employee_id
        ? await this.progression(tx, [apres.employee_id])
        : undefined;
      return this.vue(apres, apres.employee_id ? progression?.get(apres.employee_id) : undefined);
    });
  }

  async supprimer(user: SessionUser, id: string): Promise<void> {
    await this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const o = await this.un(tx, id);
      await this.exigerLaMain(tx, user, moi, o);
      await tx.execute(sql`DELETE FROM objectifs WHERE id = ${id}`);
    });
  }

  /** Évaluer — ou retirer l'évaluation (`null`). Une formation s'évalue dans l'Academy. */
  async evaluer(user: SessionUser, id: string, input: EvaluerObjectifInput): Promise<ObjectifView> {
    return this.db.withTenant(this.ctx(user), async (tx) => {
      const moi = await this.exigerAgent(tx, user);
      const o = await this.un(tx, id);
      await this.exigerLaMain(tx, user, moi, o);
      if (o.nature === 'formation') {
        problem(
          422,
          'objectifs.formation_auto',
          'Une formation est atteinte quand l’agent l’a terminée dans l’Academy',
        );
      }
      await tx.execute(sql`
        UPDATE objectifs
           SET evaluation = ${input.evaluation},
               commentaire = ${input.evaluation ? input.commentaire?.trim() || null : null},
               evalue_le = ${input.evaluation ? sql`now()` : sql`NULL`},
               updated_at = now()
         WHERE id = ${id}`);
      const apres = await this.un(tx, id);
      if (apres.niveau === 'individuel' && apres.evaluation && apres.employee_id) {
        const compte = await this.compteDe(tx, apres.employee_id);
        if (compte) {
          // Revue le lendemain, l'évaluation prend la place de la précédente.
          await notifier(tx, user.tenantId, compte, {
            type: 'objectif',
            sujet: 'objectifs',
            title: `${await this.nomDe(tx, moi)} a évalué votre objectif « ${apres.titre} »`,
            link: '/moi/objectifs',
            dedupeKey: `objectif:${apres.id}:evaluation:${this.aujourdhui()}`,
            remplace: `objectif:${apres.id}:evaluation:`,
          });
        }
      }
      return this.vue(apres);
    });
  }

  // ———————————————————————————— droits

  private async exigerAgent(tx: Tx, user: SessionUser): Promise<string> {
    const moi = await employeActif(tx, user.userId);
    if (!moi) {
      problem(403, 'objectifs.sans_dossier', 'Les objectifs se fixent entre agents');
    }
    return moi;
  }

  private async exigerDG(tx: Tx, user: SessionUser): Promise<string> {
    const moi = await this.exigerAgent(tx, user);
    if ((await directeurGeneral(tx)) !== moi) {
      problem(
        403,
        'objectifs.reserve_dg',
        'Seul le directeur général fixe les objectifs de l’APIX et des directions',
      );
    }
    return moi;
  }

  /** L'agent doit être un direct ACTIF de l'appelant — jamais le DG. */
  private async exigerSonN1(
    tx: Tx,
    moi: string,
    employeeId: string,
    evaluation = false,
  ): Promise<void> {
    const { rows } = await tx.execute(sql`
      SELECT 1 FROM employees
       WHERE id = ${employeeId} AND manager_employee_id = ${moi}
         AND (status = 'active'
              ${evaluation ? sql`OR ${evaluationEnSuspens(sql`employees.id`)}` : sql``})
         AND id IS DISTINCT FROM ${DG}`);
    if (rows.length === 0) {
      problem(403, 'objectifs.hors_equipe', 'Vous fixez les objectifs de votre équipe seulement');
    }
  }

  /** Qui a la main sur un objectif : le DG pour l'APIX et les directions, le n+1 du jour pour un agent. */
  private async exigerLaMain(
    tx: Tx,
    user: SessionUser,
    moi: string,
    o: LigneObjectif,
  ): Promise<void> {
    if (o.niveau === 'individuel') await this.exigerSonN1(tx, moi, o.employee_id!);
    else await this.exigerDG(tx, user);
  }

  // ———————————————————————————— outils

  private async lire(tx: Tx, filtre: SQL): Promise<LigneObjectif[]> {
    const { rows } = await tx.execute<LigneObjectif>(sql`
      ${SELECTION}
       WHERE ${filtre}
       ORDER BY o.echeance NULLS LAST, o.created_at, o.id`);
    return rows;
  }

  private async un(tx: Tx, id: string): Promise<LigneObjectif> {
    const { rows } = await tx.execute<LigneObjectif>(sql`${SELECTION} WHERE o.id = ${id}`);
    if (!rows[0]) problem(404, 'objectifs.introuvable', 'Objectif introuvable');
    return rows[0];
  }

  /** La direction de l'agent — la Direction Générale n'en est pas une ici. */
  private async directionSaufSommet(
    tx: Tx,
    employeeId: string,
  ): Promise<{ id: string; nom: string } | null> {
    const direction = await directionDeEmploye(tx, employeeId);
    if (!direction) return null;
    const { rows } = await tx.execute<{ sommet: string | null }>(sql`SELECT ${SOMMET} AS sommet`);
    return rows[0]?.sommet === direction.id ? null : direction;
  }

  /**
   * Les directs ACTIFS de l'agent, avec leur poste du jour, jamais le DG.
   * `evaluations` y ajoute ceux qui sont partis en laissant une
   * auto-évaluation envoyée, pas encore validée : leur n+1 la termine.
   */
  private async directs(tx: Tx, moi: string, evaluations = false): Promise<LigneMembre[]> {
    const { rows } = await tx.execute<LigneMembre>(sql`
      SELECT e.id, e.employee_number, p.given_name, p.family_name,
             a.position_title, u.name AS unite,
             ${directionDeLUnite(sql`a.org_unit_id`, 'short_name')} AS direction_abrege,
             ${directionDeLUnite(sql`a.org_unit_id`, 'name')} AS direction_nom,
             e.work_email, e.work_phone, p.phone, e.status <> 'active' AS parti
        FROM employees e
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
        LEFT JOIN LATERAL (
          SELECT position_title, org_unit_id
            FROM assignments
           WHERE employee_id = e.id
             AND (validity @> CURRENT_DATE OR lower(validity) > CURRENT_DATE)
           ORDER BY lower(validity)
           LIMIT 1
        ) a ON true
        LEFT JOIN org_units u ON u.id = a.org_unit_id AND u.deleted_at IS NULL
       WHERE e.manager_employee_id = ${moi}
         AND (e.status = 'active'
              ${evaluations ? sql`OR ${evaluationEnSuspens(sql`e.id`)}` : sql``})
         AND e.id IS DISTINCT FROM ${DG}
       ORDER BY p.family_name, p.given_name, e.id`);
    return rows;
  }

  private async progression(
    tx: Tx,
    employeeIds: string[],
  ): Promise<Map<string, TeamCourseProgress[]>> {
    return this.academy.suivi(tx, employeeIds);
  }

  private async compteDe(tx: Tx, employeeId: string): Promise<string | null> {
    const { rows } = await tx.execute<{ user_id: string | null }>(sql`
      SELECT p.user_id FROM employees e JOIN persons p ON p.id = e.person_id
       WHERE e.id = ${employeeId} AND e.status = 'active' AND p.deleted_at IS NULL`);
    return rows[0]?.user_id ?? null;
  }

  private vue(o: LigneObjectif, formations?: TeamCourseProgress[]): ObjectifView {
    const echeance = jour(o.echeance);
    let formation: ObjectifView['formation'] = null;
    if (o.nature === 'formation') {
      const suivie =
        formations?.find((f) => o.course_id !== null && f.courseId === o.course_id) ??
        // Retirée du catalogue : son certificat, s'il vaut encore, reste un acquis.
        formations?.find((f) => f.courseId === null && f.title === o.titre);
      formation = {
        courseId: o.course_id,
        statut: suivie?.status ?? null,
        lecons: suivie?.lessonCount ?? 0,
        validees: suivie?.completedLessons ?? 0,
      };
    }
    const atteint =
      o.evaluation === 'atteint' ||
      formation?.statut === 'certifiee' ||
      formation?.statut === 'terminee';
    return {
      id: o.id,
      niveau: o.niveau,
      annee: Number(o.annee),
      nature: o.nature,
      titre: o.titre,
      description: o.description,
      echeance,
      diffusion: o.diffusion,
      evaluation: o.evaluation,
      commentaire: o.commentaire,
      evalueLe: iso(o.evalue_le),
      formation,
      atteint,
      enRetard: echeance !== null && echeance < this.aujourdhui() && !atteint && !o.evaluation,
      auteur: o.auteur,
      creeLe: iso(o.created_at)!,
    };
  }

  private membre(m: LigneMembre, objectifs: ObjectifView[], aEvaluer: number): MembreSuivi {
    return {
      employeeId: m.id,
      givenName: m.given_name,
      familyName: m.family_name,
      number: m.employee_number,
      positionTitle: m.position_title,
      unitName: m.unite,
      directionShortName: m.direction_abrege,
      directionName: m.direction_nom,
      workEmail: m.work_email,
      workPhone: m.work_phone,
      phone: m.phone,
      total: objectifs.length,
      atteints: objectifs.filter((o) => o.atteint).length,
      enRetard: objectifs.filter((o) => o.enRetard).length,
      aEvaluer,
      parti: m.parti,
    };
  }

  // ———————————————————————————— prévenir

  /**
   * Un objectif fixé à un agent le prévient ; les objectifs d'une direction,
   * ses agents ; les orientations de l'APIX, ceux à qui elles sont diffusées.
   * Une notification par jour et par direction (ou pour l'APIX) : dix
   * objectifs saisis d'affilée n'en font pas dix.
   */
  private async prevenirDeLaCreation(
    tx: Tx,
    user: SessionUser,
    moi: string,
    o: LigneObjectif,
  ): Promise<void> {
    const le = this.aujourdhui();
    if (o.niveau === 'individuel' && o.employee_id) {
      const compte = await this.compteDe(tx, o.employee_id);
      if (!compte) return;
      await notifier(tx, user.tenantId, compte, {
        type: 'objectif',
        sujet: 'objectifs',
        title: `${o.auteur ?? 'Votre n+1'} vous a fixé ${o.nature === 'formation' ? 'une formation' : 'un objectif'} : ${o.titre}`,
        link: '/moi/objectifs',
        dedupeKey: `objectif:${o.id}`,
      });
      return;
    }
    const destinataires =
      o.niveau === 'direction'
        ? await this.comptes(
            tx,
            sql`${directionDeLUnite(uniteEnVigueur(sql`e.id`), 'id')} = ${o.direction_id}`,
            moi,
          )
        : o.diffusion === 'directeurs'
          ? await this.comptes(
              tx,
              sql`EXISTS (SELECT 1 FROM org_units d
                           WHERE d.manager_employee_id = e.id AND d.unit_type = 'direction'
                             AND d.deleted_at IS NULL AND d.id IS DISTINCT FROM ${SOMMET})`,
              moi,
            )
          : await this.comptes(tx, sql`TRUE`, moi);
    const quoi =
      o.niveau === 'direction'
        ? { nom: `les objectifs ${o.annee} de votre direction`, fixes: 'sont fixés' }
        : { nom: `les orientations ${o.annee} de l’APIX`, fixes: 'sont fixées' };
    const title = o.auteur
      ? `${o.auteur} a fixé ${quoi.nom}`
      : `${quoi.nom[0]!.toUpperCase()}${quoi.nom.slice(1)} ${quoi.fixes}`;
    // L'année fait partie du sujet : les orientations 2027 fixées le jour des
    // 2026 ne se confondent pas avec elles, et ne les remplacent pas.
    const sujet =
      o.niveau === 'direction'
        ? `objectifs:direction:${o.direction_id}:${o.annee}:`
        : `objectifs:apix:${o.annee}:`;
    for (const compte of destinataires) {
      await notifier(tx, user.tenantId, compte, {
        type: 'objectif',
        sujet: 'objectifs.apix',
        title,
        link: '/moi/objectifs',
        dedupeKey: `${sujet}${le}`,
        remplace: sujet,
      });
    }
  }

  /** Les comptes des agents actifs qui répondent au filtre (sur `e`), sauf l'auteur. */
  private async comptes(tx: Tx, filtre: SQL, sauf: string): Promise<string[]> {
    const { rows } = await tx.execute<{ user_id: string }>(sql`
      SELECT DISTINCT p.user_id
        FROM employees e
        JOIN persons p ON p.id = e.person_id AND p.deleted_at IS NULL
       WHERE e.status = 'active' AND p.user_id IS NOT NULL AND e.id <> ${sauf}
         AND ${filtre}`);
    return rows.map((r) => r.user_id);
  }
}
