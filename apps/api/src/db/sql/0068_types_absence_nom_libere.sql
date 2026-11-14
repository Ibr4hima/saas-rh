-- Un type d'absence retiré libère son nom : retirer « Congé de maternité »
-- puis le recréer échouait sur « Un type d'absence porte déjà ce nom ».
-- La règle porte désormais sur les types en service, à la casse près.
SET lock_timeout = '5s';

ALTER TABLE absence_types DROP CONSTRAINT absence_types_tenant_id_name_key;
CREATE UNIQUE INDEX absence_types_nom_en_service
  ON absence_types (tenant_id, lower(name)) WHERE deleted_at IS NULL;
