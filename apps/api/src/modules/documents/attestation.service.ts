import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AttestationApercu, SessionUser } from '@teranga/contracts';
import { capaciteDuDocument } from '@teranga/contracts';
import { agentDuCompte, directionDuPersonnel, pasSurSoi } from '../acces/dch';
import { vueDuTraitement } from '../acces/demandes';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';
import { dessinerEntete, ENTETE, enregistrerPolices, police } from './entete';

/**
 * Chaque libellé porte SON article.
 *
 * « dans le cadre d'un convention de stage » : le générateur écrivait cela,
 * parce qu'il collait « d'un » devant un libellé dont il ignorait le genre.
 * L'article appartient au libellé, il ne se devine pas.
 */
export const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'd’un contrat à durée indéterminée (CDI)',
  cdd: 'd’un contrat à durée déterminée (CDD)',
  stage: 'd’une convention de stage',
  consultant: 'd’un contrat de consultance',
  detachement: 'd’un détachement',
};

/**
 * « le poste de Analyste » : l'élision ne se saute pas devant une voyelle.
 * Le h muet français est indécidable sans dictionnaire ; on élide devant les
 * voyelles seules, ce qui couvre les intitulés de poste réels.
 */
export function elide(prefixe: string, mot: string): string {
  return /^[aeiouyàâäéèêëîïôöùûü]/i.test(mot.trim()) ? `${prefixe}’${mot}` : `${prefixe}e ${mot}`;
}

export interface AttestationData {
  civility: string;
  fullName: string;
  birthLine: string;
  employeeNumber: string;
  hiredOn: string;
  positionTitle: string | null;
  orgUnitName: string | null;
  contractLabel: string | null;
  /** Un stagiaire n'est pas « employé » : il est accueilli en stage. */
  stage: boolean;
  feminine: boolean;
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

/**
 * L'article d'une unité, d'après le mot qui l'ouvre.
 *
 * « au sein de la Service Comptabilité » : le générateur posait un féminin sur
 * tout, parce qu'il avait vu passer des directions. Les noms d'unités d'une
 * administration s'ouvrent par une poignée de mots ; on les connaît. Ce qu'on
 * ne reconnaît pas passe entre parenthèses, forme qui ne peut pas être fautive.
 */
const UNITE_FEMININE = /^(direction|cellule|division|agence|unité|section|coordination|brigade)\b/i;
const UNITE_MASCULINE = /^(service|bureau|département|pôle|secrétariat|centre|cabinet|comité)\b/i;

export function rattachement(unite: string): string {
  if (UNITE_FEMININE.test(unite)) return `, à la ${unite}`;
  if (UNITE_MASCULINE.test(unite)) return `, au ${unite}`;
  return ` (${unite})`;
}

/**
 * Les textes de l'attestation, tels que le PDF les imprime. L'aperçu de la
 * file des documents affiche les mêmes : une seule rédaction, deux rendus.
 */
export function textesDeLAttestation(d: AttestationData, aujourdhui: Date): AttestationApercu {
  const e = d.feminine ? 'e' : '';
  // « Nous soussignés, APIX, attestons » : la formule était doublement
  // fautive. « Nous soussignés » désigne des PERSONNES qui signent, pas une
  // société ; et le pluriel s'accordait avec un sujet singulier. Une
  // personne morale atteste en son nom propre.
  const phrase: string[] = [
    `L’${ENTETE.agence} (${ENTETE.raisonSociale}) atteste que ${d.civility} ${d.fullName}${d.birthLine}, ` +
      `matricule ${d.employeeNumber}, ` +
      (d.stage ? `est accueilli${e} en stage en son sein` : `est employé${e} en son sein`) +
      ` depuis le ${frDate(d.hiredOn)}`,
  ];
  if (d.positionTitle) {
    phrase.push(
      ` et y occupe ${elide('le poste d', d.positionTitle)}` +
        (d.orgUnitName ? rattachement(d.orgUnitName) : ''),
    );
  }
  if (d.contractLabel) phrase.push(`, dans le cadre ${d.contractLabel}`);
  phrase.push('.');
  return {
    titre: 'ATTESTATION DE TRAVAIL',
    paragraphes: [
      phrase.join(''),
      'La présente attestation lui est délivrée pour servir et valoir ce que de droit.',
    ],
    // « Fait le … » seul ne suffit pas : un acte administratif porte le lieu
    // de son émission.
    lieuEtDate: `Fait à ${ENTETE.ville}, le ${frDate(aujourdhui)}`,
    signature: [`Pour ${ENTETE.raisonSociale},`, `La ${ENTETE.service}`],
  };
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
  async forEmployee(
    user: SessionUser,
    employeeId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.exigerLeDroit(tx, user, employeeId);
      const d = await this.donnees(tx, employeeId);
      const safeNumber = d.employeeNumber.replace(/[^A-Za-z0-9-]/g, '_');
      return {
        filename: `attestation-travail-${safeNumber}.pdf`,
        pdf: await this.render(textesDeLAttestation(d, new Date())),
      };
    });
  }

  /**
   * Ce que le PDF imprimera, mot pour mot : l'aperçu de la file des documents
   * le montre tel quel, au lieu de recomposer les champs de son côté.
   */
  async apercu(user: SessionUser, employeeId: string): Promise<AttestationApercu> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      await this.exigerLeDroit(tx, user, employeeId);
      return textesDeLAttestation(await this.donnees(tx, employeeId), new Date());
    });
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
        birthDate: t.persons.birthDate,
        birthPlace: t.persons.birthPlace,
        positionTitle: t.assignments.positionTitle,
        orgUnitName: t.orgUnits.name,
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
      .leftJoin(t.orgUnits, eq(t.orgUnits.id, t.assignments.orgUnitId))
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
        'Attestation réservée aux employés en activité',
        'Pour un employé sorti, il faudra un certificat de travail (à venir).',
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

    const feminine = row.gender === 'female';
    // birthPlace contient désormais le pays de naissance : parenthèses plutôt
    // qu'une préposition (« au/en/aux » varie selon le pays).
    const birthLine =
      row.birthDate && row.birthPlace
        ? `, né${feminine ? 'e' : ''} le ${frDate(row.birthDate)} (${row.birthPlace})`
        : row.birthDate
          ? `, né${feminine ? 'e' : ''} le ${frDate(row.birthDate)}`
          : '';

    return {
      civility: row.gender === 'male' ? 'M.' : feminine ? 'Mme' : 'M./Mme',
      fullName: `${row.givenName} ${row.familyName.toUpperCase()}`,
      birthLine,
      employeeNumber: row.employeeNumber,
      hiredOn: row.hiredOn,
      positionTitle: row.positionTitle ?? null,
      orgUnitName: row.orgUnitName ?? null,
      contractLabel: contract ? (CONTRACT_LABELS[contract.contractType] ?? null) : null,
      stage: contract?.contractType === 'stage',
      feminine,
    };
  }

  private render(textes: AttestationApercu): Promise<Buffer> {
    const MARGE = 56;
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGE, bottom: 90, left: MARGE, right: MARGE },
      info: { Title: 'Attestation de travail', Author: ENTETE.raisonSociale },
    });
    enregistrerPolices(doc);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const largeur = doc.page.width - MARGE * 2;

    dessinerEntete(doc, MARGE);

    // ── Titre ──
    doc.moveDown(3);
    const ECART = 1.8;
    doc.font(police(doc, 'bold')).fontSize(15).fillColor('#111111');
    // Le trait est tracé à la main plutôt que par `underline`, qui compte
    // l'espacement ajouté APRÈS la dernière lettre et débordait d'autant.
    const largeurTitre = doc.widthOfString(textes.titre, { characterSpacing: ECART }) - ECART;
    const yTitre = doc.y;
    doc.text(textes.titre, MARGE, yTitre, {
      width: largeur,
      align: 'center',
      characterSpacing: ECART,
    });
    const xTitre = (doc.page.width - largeurTitre) / 2;
    doc
      .moveTo(xTitre, yTitre + doc.currentLineHeight() + 1)
      .lineTo(xTitre + largeurTitre, yTitre + doc.currentLineHeight() + 1)
      .lineWidth(0.9)
      .strokeColor('#111111')
      .stroke();

    // ── Corps ──
    doc.moveDown(2.6);
    doc.font(police(doc, 'normal')).fontSize(11).fillColor('#111111');
    textes.paragraphes.forEach((p, i) => {
      if (i > 0) doc.moveDown(1);
      doc.text(p, MARGE, doc.y, { width: largeur, align: 'justify', lineGap: 5 });
    });

    // ── Lieu, date et signature ──
    doc.moveDown(3);
    doc.text(textes.lieuEtDate, MARGE, doc.y, { width: largeur, align: 'right' });
    doc.moveDown(2);
    textes.signature.forEach((ligne, i) => {
      doc
        .font(police(doc, i === 0 ? 'bold' : 'normal'))
        .text(ligne, MARGE, doc.y, { width: largeur, align: 'right' });
    });

    doc.end();
    return done;
  }
}
