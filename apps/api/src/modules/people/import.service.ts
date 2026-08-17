/**
 * Import CSV des employés — le chantier n°1 de tout déploiement SIRH
 * (revue A10) : validation Zod ligne à ligne, rapport d'erreurs exhaustif,
 * mode dry-run par défaut, aucune écriture partielle par ligne.
 */
import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { ImportReport, ImportRowError, SessionUser } from '@teranga/contracts';
import { contractTypeSchema } from '@teranga/contracts';
import * as t from '../../db/schema';
import { TenantDb } from '../../db/tenant-db';

const rowSchema = z.object({
  matricule: z.string().trim().min(1).max(30),
  prenom: z.string().trim().min(1).max(80),
  nom: z.string().trim().min(1).max(80),
  date_embauche: z.iso.date({ error: 'Date attendue au format AAAA-MM-JJ' }),
  email_pro: z.email().optional().or(z.literal('')),
  telephone: z.string().trim().max(30).optional(),
  poste: z.string().trim().max(120).optional(),
  type_contrat: contractTypeSchema.optional().or(z.literal('')),
  date_debut_contrat: z.iso.date().optional().or(z.literal('')),
});
type ImportRow = z.infer<typeof rowSchema>;

/** Parseur CSV minimal : champs entre guillemets, séparateur ; ou , auto-détecté. */
export function parseCsv(content: string): string[][] {
  const firstLine = content.slice(0, content.indexOf('\n') + 1 || content.length);
  const delimiter =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const text = content.replace(/^﻿/, ''); // BOM Excel

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

@Injectable()
export class ImportService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  async importEmployees(
    user: SessionUser,
    content: string,
    dryRun: boolean,
  ): Promise<ImportReport> {
    const errors: ImportRowError[] = [];
    const rows = parseCsv(content);
    if (rows.length < 2) {
      return {
        dryRun,
        totalRows: 0,
        validRows: 0,
        importedRows: 0,
        errors: [{ line: 1, field: '(fichier)', message: 'Fichier vide ou sans ligne de données' }],
      };
    }

    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const dataRows = rows.slice(1);
    for (const required of ['matricule', 'prenom', 'nom', 'date_embauche']) {
      if (!header.includes(required)) {
        errors.push({
          line: 1,
          field: required,
          message: `Colonne obligatoire absente de l'en-tête`,
        });
      }
    }
    if (errors.length > 0) {
      return { dryRun, totalRows: dataRows.length, validRows: 0, importedRows: 0, errors };
    }

    // Validation ligne à ligne
    const valid: { line: number; row: ImportRow }[] = [];
    const seenMatricules = new Map<string, number>();
    dataRows.forEach((cells, index) => {
      const line = index + 2; // 1 = en-tête
      const record: Record<string, string> = {};
      header.forEach((col, i) => {
        record[col] = (cells[i] ?? '').trim();
      });
      const parsed = rowSchema.safeParse(record);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({ line, field: String(issue.path[0] ?? '?'), message: issue.message });
        }
        return;
      }
      const dup = seenMatricules.get(parsed.data.matricule);
      if (dup !== undefined) {
        errors.push({
          line,
          field: 'matricule',
          message: `Matricule en double dans le fichier (déjà vu ligne ${dup})`,
        });
        return;
      }
      seenMatricules.set(parsed.data.matricule, line);
      valid.push({ line, row: parsed.data });
    });

    // Collision avec les matricules existants en base
    const ctx = { tenantId: user.tenantId, userId: user.userId };
    if (valid.length > 0) {
      const existing = await this.db.withTenant(ctx, (tx) =>
        tx
          .select({ employeeNumber: t.employees.employeeNumber })
          .from(t.employees)
          .where(
            inArray(
              t.employees.employeeNumber,
              valid.map((v) => v.row.matricule),
            ),
          ),
      );
      const taken = new Set(existing.map((e) => e.employeeNumber));
      for (let i = valid.length - 1; i >= 0; i -= 1) {
        const v = valid[i];
        if (v && taken.has(v.row.matricule)) {
          errors.push({ line: v.line, field: 'matricule', message: 'Matricule déjà utilisé' });
          valid.splice(i, 1);
        }
      }
    }

    let importedRows = 0;
    if (!dryRun && valid.length > 0) {
      await this.db.withTenant(ctx, async (tx) => {
        for (const { row } of valid) {
          const personId = uuidv7();
          const employeeId = uuidv7();
          await tx.insert(t.persons).values({
            id: personId,
            tenantId: user.tenantId,
            givenName: row.prenom,
            familyName: row.nom,
            phone: row.telephone || null,
          });
          await tx.insert(t.employees).values({
            id: employeeId,
            tenantId: user.tenantId,
            personId,
            employeeNumber: row.matricule,
            hiredOn: row.date_embauche,
            workEmail: row.email_pro || null,
          });
          if (row.poste) {
            await tx.insert(t.assignments).values({
              id: uuidv7(),
              tenantId: user.tenantId,
              employeeId,
              positionTitle: row.poste,
              validity: `[${row.date_embauche},)`,
            });
          }
          if (row.type_contrat) {
            await tx.insert(t.contracts).values({
              id: uuidv7(),
              tenantId: user.tenantId,
              employeeId,
              contractType: row.type_contrat,
              startDate: row.date_debut_contrat || row.date_embauche,
            });
          }
          importedRows += 1;
        }
      });
    }

    errors.sort((a, b) => a.line - b.line);
    return {
      dryRun,
      totalRows: dataRows.length,
      validRows: valid.length,
      importedRows,
      errors,
    };
  }
}
