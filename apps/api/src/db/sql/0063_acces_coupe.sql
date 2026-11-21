-- Couper l'accès d'un compte à cette organisation, sans toucher à son
-- dossier : il ne se connecte plus jusqu'à ce qu'on le rétablisse. Qui l'a
-- coupé, et quand.
SET lock_timeout = '5s';

ALTER TABLE user_tenant_memberships
  ADD COLUMN acces_coupe_le timestamptz,
  ADD COLUMN acces_coupe_par_user_id uuid REFERENCES users (id);
