-- Le DGA (ADR-0126) : au sommet, la place à côté du responsable. La
-- désignation se fait depuis la fiche de la Direction Générale, comme celle
-- du DG, et le poste s'écrit dans les affectations.
SET lock_timeout = '5s';

ALTER TABLE org_units
  ADD COLUMN adjoint_employee_id uuid REFERENCES employees (id);

-- Seule une unité sans parent, le sommet, a un DGA ; et ce n'est pas le DG.
ALTER TABLE org_units
  ADD CONSTRAINT org_units_adjoint_au_sommet
  CHECK (adjoint_employee_id IS NULL OR parent_id IS NULL);

ALTER TABLE org_units
  ADD CONSTRAINT org_units_adjoint_distinct_du_responsable
  CHECK (adjoint_employee_id IS NULL OR adjoint_employee_id IS DISTINCT FROM manager_employee_id);
