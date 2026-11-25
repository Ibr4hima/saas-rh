-- Les objectifs fixés à un agent pour l'année, sur sa fiche d'entretien
-- (ADR-0215) : ceux que la DCH importe, que l'agent apprécie dans son
-- auto-évaluation, puis le N+1. Dans l'ordre de la fiche, chacun avec son
-- identifiant, son intitulé et ses indicateurs.
SET lock_timeout = '5s';

ALTER TABLE fiches_entretien
  ADD COLUMN objectifs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT fiches_entretien_objectifs_en_liste CHECK (jsonb_typeof(objectifs) = 'array');
