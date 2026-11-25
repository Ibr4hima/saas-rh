-- La fiche d'objectifs d'un agent, par semestre.
--
-- Décision APIX : le n+1 fixe les objectifs de son direct semestre par
-- semestre — « Objectifs du 1er semestre de 2026 », puis du 2nd. Une fiche
-- par agent, par année et par semestre. Les fiches déjà rédigées rejoignent
-- le semestre où elles l'ont été.
SET lock_timeout = '5s';

ALTER TABLE objectifs_fiches ADD COLUMN semestre smallint;

UPDATE objectifs_fiches
   SET semestre = CASE WHEN extract(month FROM created_at) <= 6 THEN 1 ELSE 2 END;

ALTER TABLE objectifs_fiches
  ALTER COLUMN semestre SET NOT NULL,
  ADD CONSTRAINT objectifs_fiches_semestre CHECK (semestre IN (1, 2)),
  DROP CONSTRAINT objectifs_fiches_une_par_annee,
  ADD CONSTRAINT objectifs_fiches_une_par_semestre UNIQUE (tenant_id, employee_id, annee, semestre);
