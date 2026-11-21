-- =============================================================================
-- 0121 : Deux N+1 (ADR-0147).
--
-- Le N+1 hiérarchique (manager_employee_id) se CALCULE désormais à partir de
-- l'organigramme : la colonne garde le résultat, que la chaîne réécrit après
-- chaque geste. Ce qui se choisit s'écrit à côté :
--   - n1_fonctionnel_employee_id : le N+1 fonctionnel, qui fixe les
--     objectifs et évalue ; NULL = le N+1 hiérarchique ;
--   - n1_unite_id / n1_dga : à la Direction Générale seulement, la place dont
--     relève l'agent à la place du DG (la tête d'une unité, ou le DGA) ;
--   - n1_avant_la_regle : le n+1 d'avant cette migration, pour que la DCH
--     revoie une fois les N+1 que la règle a changés.
-- =============================================================================

SET lock_timeout = '5s';

ALTER TABLE employees
  ADD COLUMN n1_fonctionnel_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD COLUMN n1_unite_id uuid REFERENCES org_units (id) ON DELETE SET NULL,
  ADD COLUMN n1_dga boolean NOT NULL DEFAULT false,
  ADD COLUMN n1_avant_la_regle uuid REFERENCES employees (id) ON DELETE SET NULL;

ALTER TABLE employees
  ADD CONSTRAINT employees_n1_fonctionnel_pas_soi
  CHECK (n1_fonctionnel_employee_id IS NULL OR n1_fonctionnel_employee_id <> id);

-- Une seule place choisie : la tête d'une unité, ou le DGA.
ALTER TABLE employees
  ADD CONSTRAINT employees_n1_une_seule_place
  CHECK (NOT (n1_dga AND n1_unite_id IS NOT NULL));

-- Sert « mon équipe » du N+1 fonctionnel.
CREATE INDEX employees_n1_fonctionnel_idx ON employees (tenant_id, n1_fonctionnel_employee_id)
  WHERE n1_fonctionnel_employee_id IS NOT NULL;

UPDATE employees SET n1_avant_la_regle = manager_employee_id
 WHERE status = 'active' AND manager_employee_id IS NOT NULL;
