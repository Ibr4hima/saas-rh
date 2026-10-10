-- =============================================================================
-- 0005 — Organigramme : responsable d'unité.
-- Chaque unité peut désigner un responsable (employé du tenant) : c'est le
-- « qui se référer » de la cartographie. Expand-only, aucune donnée migrée.
-- =============================================================================

SET lock_timeout = '5s';

ALTER TABLE org_units
  ADD COLUMN manager_employee_id uuid REFERENCES employees (id);

CREATE INDEX org_units_manager_idx ON org_units (manager_employee_id)
  WHERE manager_employee_id IS NOT NULL;
