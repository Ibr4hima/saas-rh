-- Un certificat se révoque, avec son motif et son auteur ; il se réémet
-- (nom ou matricule corrigé) sous un nouveau numéro : l'ancien est révoqué
-- et renvoie au nouveau, pour qui le vérifie encore.
SET lock_timeout = '5s';

ALTER TABLE academy_certificates
  ADD COLUMN revocation_motif text,
  ADD COLUMN revoque_par_user_id uuid REFERENCES users (id),
  ADD COLUMN reemis_sous text CHECK (reemis_sous ~ '^APX-[0-9A-Z]{4}-[0-9A-Z]{4}$'),
  ADD CONSTRAINT academy_certificates_revocation_motivee
    CHECK (revoked_at IS NULL OR revocation_motif IS NOT NULL OR reemis_sous IS NOT NULL);
