import { EncryptionService, VERSION_CANDIDATURES } from './encryption.service';

/* ────────────────────────────────────────────────────────────────
   Les pièces des dossiers, chiffrées au repos : les pièces des agents
   (CNI, passeport, diplômes, CV) et les justificatifs d'absence (un
   certificat médical).

   La clé des dossiers est la leur, dérivée de la clé maîtresse. Chaque
   fichier et chaque nom de fichier l'est pour SA place : l'organisation, la
   table, la ligne et la colonne entrent dans le chiffrement. Recopié sur une
   autre ligne, dans une autre organisation, il ne se lit plus. La base
   seule, volée ou sauvegardée, ne dit rien de ces pièces.

   Une ligne sans `cle_version` date d'avant (migration 0090) : elle se lit
   telle quelle, le temps que le migrateur la chiffre.
   ──────────────────────────────────────────────────────────────── */

export type TableDePieces = 'employee_documents' | 'absence_documents';

export const VERSION_PIECES = VERSION_CANDIDATURES;

const place = (table: TableDePieces, tenantId: string, id: string, colonne: string) =>
  `${tenantId}:${table}:${id}:${colonne}`;

export function chiffrerPiece(
  enc: EncryptionService,
  table: TableDePieces,
  ligne: { tenantId: string; id: string },
  piece: { filename: string; data: Buffer },
) {
  return {
    filename: enc.chiffrerTexte(
      piece.filename,
      place(table, ligne.tenantId, ligne.id, 'filename'),
      'dossiers',
    ),
    data: enc.chiffrerOctets(
      piece.data,
      place(table, ligne.tenantId, ligne.id, 'data'),
      'dossiers',
    ),
    cleVersion: VERSION_PIECES,
  };
}

export function nomDeLaPiece(
  enc: EncryptionService,
  table: TableDePieces,
  ligne: { tenantId: string; id: string; filename: string; cleVersion: number | null },
): string {
  return ligne.cleVersion === null
    ? ligne.filename
    : enc.dechiffrerTexte(
        ligne.filename,
        place(table, ligne.tenantId, ligne.id, 'filename'),
        'dossiers',
      );
}

export function contenuDeLaPiece(
  enc: EncryptionService,
  table: TableDePieces,
  ligne: { tenantId: string; id: string; data: Buffer; cleVersion: number | null },
): Buffer {
  return ligne.cleVersion === null
    ? ligne.data
    : enc.dechiffrerOctets(ligne.data, place(table, ligne.tenantId, ligne.id, 'data'), 'dossiers');
}
