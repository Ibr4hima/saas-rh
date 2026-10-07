import { EncryptionService, VERSION_CANDIDATURES } from '../../common/encryption.service';

/* ────────────────────────────────────────────────────────────────
   Les candidatures, chiffrées au repos.

   Chaque champ l'est pour SA place : l'organisation, la table, la ligne et
   la colonne entrent dans le chiffrement. Un chiffré recopié sur une autre
   candidature, ou dans une autre organisation, ne se lit plus. Une ligne
   sans `cle_version` date d'avant (migration 0079) : elle se lit telle
   quelle, le temps que le migrateur la chiffre.
   ──────────────────────────────────────────────────────────────── */

const place = (tenantId: string, table: string, id: string, colonne: string) =>
  `${tenantId}:${table}:${id}:${colonne}`;

/** L'adresse, réduite à ce qui la distingue, pour l'empreinte d'unicité. */
export const empreinteEmail = (enc: EncryptionService, jobPostingId: string, email: string) =>
  enc.indexAveugle(email.trim().toLowerCase(), `applications:email:${jobPostingId}`);

export interface CandidatureEnClair {
  givenName: string;
  familyName: string;
  email: string;
  phone: string | null;
  message: string | null;
}

export function chiffrerCandidature(
  enc: EncryptionService,
  ligne: { tenantId: string; id: string; jobPostingId: string },
  c: CandidatureEnClair,
) {
  const champ = (colonne: string, v: string) =>
    enc.chiffrerTexte(v, place(ligne.tenantId, 'applications', ligne.id, colonne));
  return {
    givenName: champ('given_name', c.givenName),
    familyName: champ('family_name', c.familyName),
    email: champ('email', c.email),
    phone: c.phone === null ? null : champ('phone', c.phone),
    message: c.message === null ? null : champ('message', c.message),
    emailIndex: empreinteEmail(enc, ligne.jobPostingId, c.email),
    cleVersion: VERSION_CANDIDATURES,
  };
}

export function dechiffrerCandidature(
  enc: EncryptionService,
  ligne: CandidatureEnClair & { tenantId: string; id: string; cleVersion: number | null },
): CandidatureEnClair {
  if (ligne.cleVersion === null) {
    const { givenName, familyName, email, phone, message } = ligne;
    return { givenName, familyName, email, phone, message };
  }
  const champ = (colonne: string, v: string) =>
    enc.dechiffrerTexte(v, place(ligne.tenantId, 'applications', ligne.id, colonne));
  return {
    givenName: champ('given_name', ligne.givenName),
    familyName: champ('family_name', ligne.familyName),
    email: champ('email', ligne.email),
    phone: ligne.phone === null ? null : champ('phone', ligne.phone),
    message: ligne.message === null ? null : champ('message', ligne.message),
  };
}

/** L'adresse seule, pour le courriel qui part au candidat. */
export function adresseDuCandidat(
  enc: EncryptionService,
  ligne: { tenantId: string; id: string; email: string; cleVersion: number | null },
): string {
  if (ligne.cleVersion === null) return ligne.email;
  return enc.dechiffrerTexte(ligne.email, place(ligne.tenantId, 'applications', ligne.id, 'email'));
}

export function chiffrerPiece(
  enc: EncryptionService,
  ligne: { tenantId: string; id: string },
  piece: { filename: string; data: Buffer },
) {
  return {
    filename: enc.chiffrerTexte(
      piece.filename,
      place(ligne.tenantId, 'application_documents', ligne.id, 'filename'),
    ),
    data: enc.chiffrerOctets(
      piece.data,
      place(ligne.tenantId, 'application_documents', ligne.id, 'data'),
    ),
    cleVersion: VERSION_CANDIDATURES,
  };
}

export function nomDeLaPiece(
  enc: EncryptionService,
  ligne: { tenantId: string; id: string; filename: string; cleVersion: number | null },
): string {
  return ligne.cleVersion === null
    ? ligne.filename
    : enc.dechiffrerTexte(
        ligne.filename,
        place(ligne.tenantId, 'application_documents', ligne.id, 'filename'),
      );
}

export function contenuDeLaPiece(
  enc: EncryptionService,
  ligne: { tenantId: string; id: string; data: Buffer; cleVersion: number | null },
): Buffer {
  return ligne.cleVersion === null
    ? ligne.data
    : enc.dechiffrerOctets(
        ligne.data,
        place(ligne.tenantId, 'application_documents', ligne.id, 'data'),
      );
}
