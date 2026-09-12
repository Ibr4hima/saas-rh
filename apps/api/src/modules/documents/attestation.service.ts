import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { SessionUser } from '@teranga/contracts';
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

interface AttestationData {
  civility: string;
  fullName: string;
  birthLine: string;
  employeeNumber: string;
  hiredOn: string;
  positionTitle: string | null;
  orgUnitName: string | null;
  contractLabel: string | null;
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

@Injectable()
export class AttestationService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Attestation générée par la RH depuis la fiche. */
  async forEmployee(
    user: SessionUser,
    employeeId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, (tx) =>
      this.build(tx, user.tenantId, employeeId),
    );
  }

  private async build(
    tx: Tx,
    tenantId: string,
    employeeId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
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

    const [contract] = await tx
      .select({ contractType: t.contracts.contractType })
      .from(t.contracts)
      .where(eq(t.contracts.employeeId, employeeId))
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

    const data: AttestationData = {
      civility: row.gender === 'male' ? 'M.' : feminine ? 'Mme' : 'M./Mme',
      fullName: `${row.givenName} ${row.familyName.toUpperCase()}`,
      birthLine,
      employeeNumber: row.employeeNumber,
      hiredOn: row.hiredOn,
      positionTitle: row.positionTitle ?? null,
      orgUnitName: row.orgUnitName ?? null,
      contractLabel: contract ? (CONTRACT_LABELS[contract.contractType] ?? null) : null,
      feminine,
    };
    const safeNumber = row.employeeNumber.replace(/[^A-Za-z0-9-]/g, '_');
    return {
      filename: `attestation-travail-${safeNumber}.pdf`,
      pdf: await this.render(data),
    };
  }

  private render(d: AttestationData): Promise<Buffer> {
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

    const today = new Date();
    const largeur = doc.page.width - MARGE * 2;
    const e = d.feminine ? 'e' : '';

    dessinerEntete(doc, MARGE);

    // ── Titre ──
    doc.moveDown(3);
    const titre = 'ATTESTATION DE TRAVAIL';
    const ECART = 1.8;
    doc.font(police(doc, 'bold')).fontSize(15).fillColor('#111111');
    // Le trait est tracé à la main plutôt que par `underline`, qui compte
    // l'espacement ajouté APRÈS la dernière lettre et débordait d'autant.
    const largeurTitre = doc.widthOfString(titre, { characterSpacing: ECART }) - ECART;
    const yTitre = doc.y;
    doc.text(titre, MARGE, yTitre, { width: largeur, align: 'center', characterSpacing: ECART });
    const xTitre = (doc.page.width - largeurTitre) / 2;
    doc
      .moveTo(xTitre, yTitre + doc.currentLineHeight() + 1)
      .lineTo(xTitre + largeurTitre, yTitre + doc.currentLineHeight() + 1)
      .lineWidth(0.9)
      .strokeColor('#111111')
      .stroke();

    // ── Corps ──
    //
    // « Nous soussignés, APIX, attestons » : la formule était doublement
    // fautive. « Nous soussignés » désigne des PERSONNES qui signent, pas une
    // société ; et le pluriel s'accordait avec un sujet singulier. Une
    // personne morale atteste en son nom propre.
    const phrase: string[] = [
      `L’${ENTETE.agence} (${ENTETE.raisonSociale}) atteste que ${d.civility} ${d.fullName}${d.birthLine}, ` +
        `matricule ${d.employeeNumber}, est employé${e} en son sein depuis le ${frDate(d.hiredOn)}`,
    ];
    if (d.positionTitle) {
      phrase.push(
        ` et y occupe ${elide('le poste d', d.positionTitle)}` +
          (d.orgUnitName ? rattachement(d.orgUnitName) : ''),
      );
    }
    if (d.contractLabel) phrase.push(`, dans le cadre ${d.contractLabel}`);
    phrase.push('.');

    doc.moveDown(2.6);
    doc.font(police(doc, 'normal')).fontSize(11).fillColor('#111111');
    doc.text(phrase.join(''), MARGE, doc.y, { width: largeur, align: 'justify', lineGap: 5 });
    doc.moveDown(1);
    doc.text(
      `La présente attestation lui est délivrée pour servir et valoir ce que de droit.`,
      MARGE,
      doc.y,
      { width: largeur, align: 'justify', lineGap: 5 },
    );

    // ── Lieu, date et signature ──
    //
    // « Fait le … » seul ne suffit pas : un acte administratif porte le lieu
    // de son émission.
    doc.moveDown(3);
    doc.text(`Fait à ${ENTETE.ville}, le ${frDate(today)}`, MARGE, doc.y, {
      width: largeur,
      align: 'right',
    });
    doc.moveDown(2);
    doc
      .font(police(doc, 'bold'))
      .text(`Pour ${ENTETE.raisonSociale},`, MARGE, doc.y, { width: largeur, align: 'right' });
    doc
      .font(police(doc, 'normal'))
      .text(`La ${ENTETE.service}`, MARGE, doc.y, { width: largeur, align: 'right' });

    doc.end();
    return done;
  }
}
