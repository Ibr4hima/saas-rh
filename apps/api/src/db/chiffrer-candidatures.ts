import type { Client } from 'pg';
import { EncryptionService } from '../common/encryption.service';
import { chiffrerCandidature, chiffrerPiece } from '../modules/recruitment/chiffrement';

/**
 * Les candidatures déposées avant le chiffrement (migration 0079) se
 * chiffrent ici, une fois, juste après les migrations SQL : la clé n'est pas
 * en base, le SQL ne peut pas le faire. Par lots, chacun dans sa
 * transaction ; relancé, il reprend où il s'est arrêté.
 */
export async function chiffrerLesCandidatures(client: Client): Promise<number> {
  const { rows: pret } = await client.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'application_documents'
       AND column_name = 'cle_version'`);
  if (pret.length === 0) return 0;

  let enc: EncryptionService | null = null;
  let n = 0;
  for (;;) {
    const { rows } = await client.query<{
      id: string;
      tenant_id: string;
      job_posting_id: string;
      given_name: string;
      family_name: string;
      email: string;
      phone: string | null;
      message: string | null;
    }>(`SELECT id, tenant_id, job_posting_id, given_name, family_name, email, phone, message
          FROM applications WHERE cle_version IS NULL ORDER BY id LIMIT 200`);
    if (rows.length === 0) break;
    enc ??= new EncryptionService();
    await client.query('BEGIN');
    for (const r of rows) {
      const c = chiffrerCandidature(
        enc,
        { tenantId: r.tenant_id, id: r.id, jobPostingId: r.job_posting_id },
        {
          givenName: r.given_name,
          familyName: r.family_name,
          email: r.email,
          phone: r.phone,
          message: r.message,
        },
      );
      await client.query(
        `UPDATE applications
            SET given_name = $2, family_name = $3, email = $4, phone = $5, message = $6,
                email_index = $7, cle_version = $8
          WHERE id = $1 AND cle_version IS NULL`,
        [r.id, c.givenName, c.familyName, c.email, c.phone, c.message, c.emailIndex, c.cleVersion],
      );
    }
    await client.query('COMMIT');
    n += rows.length;
  }
  for (;;) {
    // Les pièces pèsent jusqu'à 5 Mo : par petits lots.
    const { rows } = await client.query<{
      id: string;
      tenant_id: string;
      filename: string;
      data: Buffer;
    }>(`SELECT id, tenant_id, filename, data FROM application_documents
         WHERE cle_version IS NULL ORDER BY id LIMIT 10`);
    if (rows.length === 0) break;
    enc ??= new EncryptionService();
    await client.query('BEGIN');
    for (const r of rows) {
      const p = chiffrerPiece(enc, { tenantId: r.tenant_id, id: r.id }, r);
      await client.query(
        `UPDATE application_documents SET filename = $2, data = $3, cle_version = $4
          WHERE id = $1 AND cle_version IS NULL`,
        [r.id, p.filename, p.data, p.cleVersion],
      );
    }
    await client.query('COMMIT');
    n += rows.length;
  }
  return n;
}
