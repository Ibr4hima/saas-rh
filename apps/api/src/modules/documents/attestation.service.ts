import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { SessionUser } from '@teranga/contracts';
import { capaciteDuDocument, nomDuDocumentGenere } from '@teranga/contracts';
import { agentDuCompte, directionDuPersonnel, pasSurSoi } from '../acces/dch';
import { vueDuTraitement } from '../acces/demandes';
import { debutDeLAnciennete } from '../people/anciennete';
import { DG } from '../people/chaine';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { ENTETE } from './entete';
import { nouvelleFeuille, type DocumentPdf, type Passage } from './feuille';

/*
 * L'attestation de travail, sur le modèle officiel de l'APIX (ADR-0086) :
 * l'en-tête de la République, le numéro à porter à la main et la date, le
 * timbre, le titre encadré, puis trois paragraphes. Qui atteste dirige le
 * sommet de l'organigramme, la direction générale. L'espace sous le texte
 * reste libre pour la signature et le cachet.
 */

/**
 * Le contrat cité : chaque libellé porte SON article.
 *
 * « dans le cadre d'un convention de stage » : le générateur écrivait cela,
 * parce qu'il collait « d'un » devant un libellé dont il ignorait le genre.
 * L'article appartient au libellé, il ne se devine pas. Le stage n'y est
 * pas : il relève de l'attestation de stage.
 */
export const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'd’un contrat à durée indéterminée',
  cdd: 'd’un contrat à durée déterminée',
  consultant: 'd’un contrat de consultance',
  detachement: 'd’un détachement',
};

/**
 * « la fonction de Analyste » : l'élision ne se saute pas devant une voyelle.
 * Le h muet français est indécidable sans dictionnaire ; on élide devant les
 * voyelles seules, ce qui couvre les intitulés de poste réels.
 */
export function elide(prefixe: string, mot: string): string {
  return /^[aeiouyàâäéèêëîïôöùûü]/i.test(mot.trim()) ? `${prefixe}’${mot}` : `${prefixe}e ${mot}`;
}

export function frDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(`${iso}T00:00:00`) : iso;
  const texte = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
  // Le premier du mois est un ORDINAL en français : « le 1er février », jamais
  // « le 1 février ». Intl ne le sait pas, c'est un usage, pas une locale.
  return d.getDate() === 1 ? texte.replace(/^1 /, '1er ') : texte;
}

/** Une personne que l'attestation nomme : son nom, et le genre que son dossier porte. */
export interface Personne {
  /** « Moussa NDIAYE » : le prénom, puis le nom en capitales. */
  nom: string;
  genre: string | null;
}

export interface AttestationData {
  agent: Personne;
  employeeNumber: string;
  /** Le premier jour de l'ancienneté (ADR-0083) ; à défaut, celui de l'embauche. */
  depuis: string;
  poste: string | null;
  /** Le type du contrat en cours ; null : aucun. */
  contrat: string | null;
  /** Qui atteste : qui dirige le sommet de l'organigramme ; null : personne n'y est désigné. */
  signataire: Personne | null;
}

/** Ce que l'attestation imprime, bloc par bloc. */
export interface TextesDeLAttestation {
  reference: string;
  lieuEtDate: string;
  timbre: string;
  titre: string;
  paragraphes: Passage[][];
}

const INSECABLE = ' ';
/** Le blanc à remplir à la main quand l'organigramme ne désigne personne. */
const A_REMPLIR = '……………………………';

/**
 * Les mots qui s'accordent avec une personne, d'après le genre que son
 * dossier porte. Sans genre connu, les deux formes, comme sur un formulaire.
 */
function accords(genre: string | null) {
  if (genre === 'female') {
    return {
      civilite: 'Madame',
      e: 'e',
      pronom: 'Elle',
      le: 'La',
      direction: 'Directrice Générale',
    };
  }
  if (genre === 'male') {
    return { civilite: 'Monsieur', e: '', pronom: 'Il', le: 'Le', direction: 'Directeur Général' };
  }
  return {
    civilite: 'Monsieur/Madame',
    e: '(e)',
    pronom: 'Il/Elle',
    le: 'Le',
    direction: 'Directeur Général',
  };
}

/** Un texte que la justification ne coupe ni n'étire : une civilité et son nom, une date. */
const insecable = (texte: string) => texte.replace(/ /g, INSECABLE);

/**
 * Les textes de l'attestation, aux mots du modèle de l'APIX. Les noms et la
 * date d'entrée sont en gras, comme sur le modèle, chacun d'un seul tenant.
 */
export function textesDeLAttestation(d: AttestationData, aujourdhui: Date): TextesDeLAttestation {
  const agent = accords(d.agent.genre);
  const signataire = accords(d.signataire?.genre ?? null);
  const contrat = d.contrat ? CONTRACT_LABELS[d.contrat] : undefined;
  const fonction = d.poste
    ? `${agent.pronom} occupe actuellement ${elide('la fonction d', d.poste)}` +
      (contrat ? `, au titre ${contrat}.` : '.')
    : contrat
      ? `${agent.pronom} est en fonction au titre ${contrat}.`
      : null;
  return {
    reference: ENTETE.referenceDCH,
    lieuEtDate: `${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    // Le timbre nomme qui signe : le DG, qui atteste dans le corps. Le modèle
    // portait « Le Directeur Général Adjoint » ; l'APIX a retenu le DG.
    timbre: `${signataire.le} ${signataire.direction}`,
    titre: 'ATTESTATION DE TRAVAIL',
    paragraphes: [
      [
        { texte: `Je soussigné${signataire.e}, ` },
        d.signataire
          ? { texte: insecable(`${signataire.civilite} ${d.signataire.nom}`), gras: true }
          : { texte: A_REMPLIR },
        { texte: `, ${signataire.direction}, atteste par la présente que ` },
        { texte: insecable(`${agent.civilite} ${d.agent.nom}`), gras: true },
        { texte: ` est employé${agent.e} à ${ENTETE.sigle} depuis le ` },
        { texte: insecable(frDate(d.depuis)), gras: true },
        { texte: '.' },
      ],
      ...(fonction ? [[{ texte: fonction }]] : []),
      [
        {
          texte:
            'En foi de quoi, la présente attestation est établie pour servir et valoir ce que de droit.',
        },
      ],
    ],
  };
}

/** L'attestation en PDF, sur la feuille de la DCH. */
export function pdfDeLAttestation(
  textes: TextesDeLAttestation,
  { logo }: { logo?: string | null } = {},
): Promise<Buffer> {
  const feuille = nouvelleFeuille({ titre: 'Attestation de travail', logo });
  feuille.entete({ reference: textes.reference, lieuEtDate: textes.lieuEtDate });
  // Le timbre est en Comic Sans MS sur le modèle de l'APIX.
  feuille.timbre(textes.timbre, { police: 'comic' });
  feuille.titreEncadre(textes.titre);
  textes.paragraphes.forEach((p, i) => feuille.paragraphe(p, { avant: i === 0 ? 40 : 14 }));
  return feuille.terminer();
}

@Injectable()
export class AttestationService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /**
   * L'attestation d'un agent : qui traite, en ce moment, sa demande
   * d'attestation de travail. Une demande d'un autre document n'y donne pas
   * droit, et le droit s'éteint avec la demande : une fois prête, refusée ou
   * annulée, ou la délégation retirée. Gérer les dossiers n'y suffit pas, les
   * attestations se délèguent à part. L'administrateur garde la main pour
   * contrôler le modèle.
   */
  async forEmployee(user: SessionUser, employeeId: string): Promise<DocumentPdf> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.exigerLeDroit(tx, user, employeeId);
      return this.pdfPour(tx, employeeId);
    });
  }

  /**
   * Le PDF, sans contrôle des droits : à l'appelant de les avoir vérifiés.
   * La file des documents et « Générer des documents » (ADR-0085) ont chacune
   * les siens.
   */
  async pdfPour(tx: Tx, employeeId: string): Promise<DocumentPdf> {
    const d = await this.donnees(tx, employeeId);
    return {
      filename: nomDuDocumentGenere('attestation_travail', d.employeeNumber),
      pdf: await pdfDeLAttestation(textesDeLAttestation(d, new Date())),
    };
  }

  /** Ce que le PDF imprimerait aujourd'hui pour ce dossier, sans contrôle des droits. */
  async textesPour(tx: Tx, employeeId: string): Promise<TextesDeLAttestation> {
    return textesDeLAttestation(await this.donnees(tx, employeeId), new Date());
  }

  private async exigerLeDroit(tx: Tx, user: SessionUser, employeeId: string): Promise<void> {
    // La sienne se demande depuis « Mes documents », comme pour tout agent.
    await pasSurSoi(tx, user.userId, [employeeId], 'établir votre propre attestation');
    if (user.role !== 'admin' && !(await this.traiteSaDemande(tx, user, employeeId))) {
      problem(403, 'auth.forbidden', 'Droits insuffisants pour cette action');
    }
  }

  /** Une demande d'attestation de travail de cet agent, encore ouverte, que l'appelant traite. */
  private async traiteSaDemande(tx: Tx, user: SessionUser, employeeId: string): Promise<boolean> {
    const moi = await agentDuCompte(tx, user.userId);
    const dch = await directionDuPersonnel(tx);
    const { rows } = await tx.execute<{ confiee_a_employee_id: string | null }>(sql`
      SELECT confiee_a_employee_id FROM document_requests
       WHERE employee_id = ${employeeId} AND status IN ('received', 'processing')
         AND 'attestation_travail' = ANY (doc_types)`);
    const capacite = capaciteDuDocument('attestation_travail');
    for (const r of rows) {
      const d = { employeeId, confieeA: r.confiee_a_employee_id };
      if ((await vueDuTraitement(tx, capacite, d, moi, dch)).peutTraiter) return true;
    }
    return false;
  }

  private async donnees(tx: Tx, employeeId: string): Promise<AttestationData> {
    const [row] = await tx
      .select({
        employeeNumber: t.employees.employeeNumber,
        status: t.employees.status,
        hiredOn: t.employees.hiredOn,
        givenName: t.persons.givenName,
        familyName: t.persons.familyName,
        gender: t.persons.gender,
        positionTitle: t.assignments.positionTitle,
      })
      .from(t.employees)
      .innerJoin(t.persons, eq(t.persons.id, t.employees.personId))
      .innerJoin(t.tenants, eq(t.tenants.id, t.employees.tenantId))
      .leftJoin(
        t.assignments,
        and(
          eq(t.assignments.employeeId, t.employees.id),
          sql`${t.assignments.validity} @> CURRENT_DATE`,
        ),
      )
      .where(eq(t.employees.id, employeeId))
      .limit(1);
    if (!row) {
      problem(404, 'people.employee_not_found', 'Employé introuvable');
    }
    if (row.status !== 'active') {
      // Un dossier suspendu ou sorti relève d'un certificat de travail, pas
      // d'une attestation d'emploi en cours : on refuse plutôt que de mentir.
      problem(
        422,
        'documents.not_active',
        'Attestation réservée aux agents en activité',
        'Un dossier inactif relève du certificat de travail.',
      );
    }

    // Le contrat en cours : le dernier COMMENCÉ. Un CDI enregistré d'avance,
    // qui prendra la suite d'un CDD, ne se cite pas avant son premier jour.
    const [contract] = await tx
      .select({ contractType: t.contracts.contractType })
      .from(t.contracts)
      .where(
        and(eq(t.contracts.employeeId, employeeId), sql`${t.contracts.startDate} <= CURRENT_DATE`),
      )
      .orderBy(desc(t.contracts.startDate))
      .limit(1);
    if (contract?.contractType === 'stage') {
      problem(
        422,
        'documents.stage',
        'Attestation de travail réservée aux contrats de travail',
        'Pour un stage, c’est l’attestation de stage qui convient.',
      );
    }

    // La date d'entrée : le début de l'ancienneté, qui ne compte ni le stage ni
    // une suite de contrats interrompue (ADR-0083) ; à défaut, l'embauche.
    const { rows: anciennete } = await tx.execute<{ depuis: string | null }>(
      sql`SELECT ${debutDeLAnciennete(employeeId, sql`CURRENT_DATE`)}::text AS depuis`,
    );
    const { rows: dg } = await tx.execute<{
      given_name: string;
      family_name: string;
      gender: string | null;
    }>(sql`
      SELECT p.given_name, p.family_name, p.gender
        FROM employees e JOIN persons p ON p.id = e.person_id
       WHERE e.id = ${DG}`);
    const signataire = dg[0];

    return {
      agent: {
        nom: `${row.givenName} ${row.familyName.toUpperCase()}`,
        genre: row.gender ?? null,
      },
      employeeNumber: row.employeeNumber,
      depuis: anciennete[0]?.depuis ?? row.hiredOn,
      poste: row.positionTitle ?? null,
      contrat: contract?.contractType ?? null,
      signataire: signataire
        ? {
            nom: `${signataire.given_name} ${signataire.family_name.toUpperCase()}`,
            genre: signataire.gender,
          }
        : null,
    };
  }
}
