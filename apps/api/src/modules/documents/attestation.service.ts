import { Inject, Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { SessionUser } from '@teranga/contracts';
import { problem } from '../../common/problem';
import * as t from '../../db/schema';
import { TenantDb, Tx } from '../../db/tenant-db';

const CONTRACT_LABELS: Record<string, string> = {
  cdi: 'contrat à durée indéterminée (CDI)',
  cdd: 'contrat à durée déterminée (CDD)',
  stage: 'convention de stage',
  consultant: 'contrat de consultance',
  detachement: 'détachement',
};

interface AttestationData {
  organizationName: string;
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

function frDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(`${iso}T00:00:00`) : iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

@Injectable()
export class AttestationService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  /** Attestation de l'employé relié au compte connecté (self-service). */
  async forSelf(user: SessionUser): Promise<{ filename: string; pdf: Buffer }> {
    return this.db.withTenant({ tenantId: user.tenantId, userId: user.userId }, async (tx) => {
      const [row] = await tx
        .select({ employeeId: t.employees.id })
        .from(t.persons)
        .innerJoin(t.employees, eq(t.employees.personId, t.persons.id))
        .where(and(eq(t.persons.userId, user.userId), isNull(t.persons.deletedAt)))
        .limit(1);
      if (!row) {
        problem(404, 'me.no_employee_record', 'Aucun dossier employé relié à ce compte');
      }
      return this.build(tx, user.tenantId, row.employeeId);
    });
  }

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
        organizationName: t.tenants.name,
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
    const birthLine =
      row.birthDate && row.birthPlace
        ? `, né${feminine ? 'e' : ''} le ${frDate(row.birthDate)} à ${row.birthPlace}`
        : row.birthDate
          ? `, né${feminine ? 'e' : ''} le ${frDate(row.birthDate)}`
          : '';

    const data: AttestationData = {
      organizationName: row.organizationName,
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
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 72, bottom: 72, left: 72, right: 72 },
      info: { Title: 'Attestation de travail', Author: d.organizationName },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const today = new Date();
    const ref = `ATT-${d.employeeNumber}-${today.toISOString().slice(0, 10).replaceAll('-', '')}`;

    // En-tête organisation
    doc.font('Helvetica-Bold').fontSize(16).text(d.organizationName);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#555555')
      .text('Direction des Ressources Humaines');
    doc.moveDown(0.5);
    doc
      .moveTo(72, doc.y)
      .lineTo(doc.page.width - 72, doc.y)
      .lineWidth(1)
      .strokeColor('#1f2a44')
      .stroke();

    doc.moveDown(1);
    doc.fillColor('#555555').fontSize(9).text(`Réf. : ${ref}`, { align: 'right' });

    // Titre
    doc.moveDown(2.5);
    doc
      .fillColor('#111111')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('ATTESTATION DE TRAVAIL', { align: 'center', characterSpacing: 2 });

    // Corps
    const e = d.feminine ? 'e' : '';
    const parts = [
      `Nous soussignés, ${d.organizationName}, attestons que ${d.civility} ${d.fullName}${d.birthLine}, matricule ${d.employeeNumber}, est employé${e} au sein de notre organisation depuis le ${frDate(d.hiredOn)}`,
    ];
    if (d.positionTitle) {
      parts.push(
        ` et occupe actuellement le poste de ${d.positionTitle}${d.orgUnitName ? ` (${d.orgUnitName})` : ''}`,
      );
    }
    if (d.contractLabel) parts.push(`, dans le cadre d'un ${d.contractLabel}`);
    parts.push('.');

    doc.moveDown(2.5);
    doc.font('Helvetica').fontSize(11).fillColor('#111111');
    doc.text(parts.join(''), { align: 'justify', lineGap: 5 });
    doc.moveDown(1);
    doc.text(
      `La présente attestation est délivrée à l'intéressé${e} pour servir et valoir ce que de droit.`,
      { align: 'justify', lineGap: 5 },
    );

    // Date et signature
    doc.moveDown(3);
    doc.text(`Fait le ${frDate(today)}.`, { align: 'right' });
    doc.moveDown(2);
    doc.font('Helvetica-Bold').text(`Pour ${d.organizationName},`, { align: 'right' });
    doc.font('Helvetica').text('La Direction des Ressources Humaines', { align: 'right' });

    // Pied de page
    doc
      .fontSize(8)
      .fillColor('#888888')
      .text(
        `Document généré électroniquement via Teranga RH le ${frDate(today)} — réf. ${ref}. ` +
          'Sans signature ni cachet, il appartient au destinataire de vérifier son authenticité auprès de l’employeur.',
        72,
        doc.page.height - 100,
        { width: doc.page.width - 144, align: 'center', lineGap: 2 },
      );

    doc.end();
    return done;
  }
}
