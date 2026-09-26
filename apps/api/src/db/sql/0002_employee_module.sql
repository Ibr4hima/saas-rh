-- =============================================================================
-- 0002 — Module dossier employé : état civil étendu, contrats, champs custom.
-- Expand-only. La CNI est stockée CHIFFRÉE côté application (AES-256-GCM,
-- ADR-0002/ch.04) : la colonne ne contient jamais de clair.
-- =============================================================================

SET lock_timeout = '5s';

-- --- Personne : état civil et contacts d'urgence -----------------------------

ALTER TABLE persons
  ADD COLUMN marital_status text
    CHECK (marital_status IN ('single', 'married', 'divorced', 'widowed')),
  ADD COLUMN birth_place text,
  ADD COLUMN nationality char(2) NOT NULL DEFAULT 'SN',
  ADD COLUMN national_id_encrypted text,
  ADD COLUMN emergency_contact_name text,
  ADD COLUMN emergency_contact_phone text;

-- --- Employé : coordonnées professionnelles et champs custom -----------------
-- custom_fields : le mécanisme anti-scope-creep (ADR ch.08) — toute demande
-- client spécifique devient une clé ici, jamais une colonne codée en dur.

ALTER TABLE employees
  ADD COLUMN work_email text,
  ADD COLUMN work_phone text,
  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';

-- --- Contrats -----------------------------------------------------------------
-- Un employé peut enchaîner plusieurs contrats (CDD renouvelé, stage → CDI…).
-- L'avenant viendra en table dédiée quand la paie l'exigera (ch.03).

CREATE TABLE contracts (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  employee_id       uuid NOT NULL REFERENCES employees (id),
  contract_type     text NOT NULL
                    CHECK (contract_type IN ('cdi', 'cdd', 'stage', 'consultant', 'detachement')),
  start_date        date NOT NULL,
  end_date          date,
  trial_period_end  date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX contracts_employee_idx ON contracts (tenant_id, employee_id, start_date DESC);
CREATE TRIGGER contracts_updated_at BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contracts
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

CREATE TRIGGER contracts_audit
  AFTER INSERT OR UPDATE OR DELETE ON contracts
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO app_user;
