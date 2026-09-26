-- =============================================================================
-- 0013 — Manager d'un employé.
--
-- Distinct du responsable d'unité (org_units.manager_employee_id) : celui-ci
-- désigne QUI DIRIGE UNE UNITÉ, celui-là À QUI UN AGENT REND COMPTE. Les deux
-- coïncident souvent, pas toujours — un chargé de mission peut relever d'un
-- directeur sans que son service change de tête.
--
-- Facultatif : un directeur général n'a pas de manager.
-- Expand-only, colonne NULL partout à la création.
-- =============================================================================

SET lock_timeout = '5s';

ALTER TABLE employees
  ADD COLUMN manager_employee_id uuid REFERENCES employees (id);

-- Personne ne se manage soi-même. Les boucles plus longues (A → B → A) ne
-- s'expriment pas en CHECK : elles sont refusées côté applicatif, par
-- remontée récursive de la chaîne hiérarchique.
ALTER TABLE employees
  ADD CONSTRAINT employees_manager_not_self
  CHECK (manager_employee_id IS NULL OR manager_employee_id <> id);

-- Sert la colonne « Manager » de la liste et la recherche des subordonnés.
CREATE INDEX employees_manager_idx ON employees (tenant_id, manager_employee_id)
  WHERE manager_employee_id IS NOT NULL;
