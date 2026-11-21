import type { Client } from 'pg';
import { EncryptionService } from '../common/encryption.service';
import { chiffrerPiece, type TableDePieces } from '../common/pieces-chiffrees';

/**
 * Les pièces déposées avant le chiffrement (migration 0090) se chiffrent
 * ici, une fois, juste après les migrations SQL : la clé n'est pas en base.
 * Par petits lots (une pièce pèse jusqu'à quelques mégaoctets), chacun dans
 * sa transaction ; relancé, il reprend où il s'est arrêté.
 *
 * Une ligne réécrite laisse son ancienne version sur le disque jusqu'au
 * prochain nettoyage : la table se réécrit entière une fois le lot fini
 * (VACUUM FULL), pour que le clair n'y reste pas.
 */
export async function chiffrerLesPieces(client: Client): Promise<number> {
  let enc: EncryptionService | null = null;
  let total = 0;
  for (const table of ['employee_documents', 'absence_documents'] as TableDePieces[]) {
    const { rows: pret } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'cle_version'`,
      [table],
    );
    if (pret.length === 0) continue;
    let n = 0;
    for (;;) {
      const { rows } = await client.query<{
        id: string;
        tenant_id: string;
        filename: string;
        data: Buffer;
      }>(`SELECT id, tenant_id, filename, data FROM ${table}
           WHERE cle_version IS NULL ORDER BY id LIMIT 10`);
      if (rows.length === 0) break;
      enc ??= new EncryptionService();
      await client.query('BEGIN');
      for (const r of rows) {
        const p = chiffrerPiece(enc, table, { tenantId: r.tenant_id, id: r.id }, r);
        await client.query(
          `UPDATE ${table} SET filename = $2, data = $3, cle_version = $4
            WHERE id = $1 AND cle_version IS NULL`,
          [r.id, p.filename, p.data, p.cleVersion],
        );
      }
      await client.query('COMMIT');
      n += rows.length;
    }
    if (n > 0) await client.query(`VACUUM FULL ${table}`);
    total += n;
  }
  return total;
}
