-- =============================================================================
-- 0007 — Pièce d'identité structurée sur le dossier personne.
-- Le simple « N° CNI » devient : type de pièce (CNI ou passeport), numéro
-- (toujours chiffré applicativement dans national_id_encrypted), date de
-- délivrance et date d'expiration. Expand-only : la colonne chiffrée existante
-- est conservée telle quelle, les nouveaux champs sont nullables.
-- =============================================================================

SET lock_timeout = '5s';

ALTER TABLE persons
  ADD COLUMN id_document_type text
    CHECK (id_document_type IN ('cni', 'passport')),
  ADD COLUMN id_document_issued_on date,
  ADD COLUMN id_document_expires_on date,
  ADD CONSTRAINT persons_id_document_dates_chk
    CHECK (
      id_document_issued_on IS NULL
      OR id_document_expires_on IS NULL
      OR id_document_issued_on < id_document_expires_on
    );
