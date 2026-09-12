-- =============================================================================
-- 0003 — Module congés & absences : types paramétrables, jours fériés,
-- soldes (reprise incluse), demandes avec anti-chevauchement, circuit
-- d'approbation à N niveaux (chaîne de visas), visas tracés.
-- Expand-only. RLS forcée + audit + grants sur chaque table (ADR-0002/0008).
-- =============================================================================

SET lock_timeout = '5s';

-- --- Types d'absences ---------------------------------------------------------

CREATE TABLE absence_types (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  name                text NOT NULL,
  -- true : les jours pris se décomptent d'un solde (congé annuel) ;
  -- false : absence suivie mais sans solde (maladie, mission…)
  deducts_balance     boolean NOT NULL DEFAULT true,
  -- droit annuel par défaut appliqué à la création d'un solde (ex : 24 j — à
  -- vérifier CCNI) ; NULL = pas de droit par défaut
  default_annual_days numeric(5, 2),
  requires_document   boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  UNIQUE (tenant_id, name)
);
CREATE TRIGGER absence_types_updated_at BEFORE UPDATE ON absence_types
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- Jours fériés (éditables en cours d'année : Korité, Tabaski…) --------------

CREATE TABLE holidays (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  day        date NOT NULL,
  label      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, day)
);

-- --- Soldes (droits) par employé / type / année --------------------------------
-- Les jours PRIS ne sont jamais stockés : ils se calculent depuis les demandes
-- approuvées (zéro double comptabilité). entitled_days porte la reprise des
-- soldes initiaux (revue A10) et les droits annuels.

CREATE TABLE absence_balances (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  employee_id     uuid NOT NULL REFERENCES employees (id),
  absence_type_id uuid NOT NULL REFERENCES absence_types (id),
  year            int NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  entitled_days   numeric(5, 2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, absence_type_id, year)
);
CREATE TRIGGER absence_balances_updated_at BEFORE UPDATE ON absence_balances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- Circuit d'approbation (chaîne de visas, configurable par tenant) ----------

CREATE TABLE approval_chains (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  request_type text NOT NULL DEFAULT 'absence' CHECK (request_type IN ('absence')),
  -- niveaux ordonnés : chaque niveau est validé par un utilisateur portant ce
  -- rôle (l'admin peut toujours viser n'importe quel niveau)
  levels       text[] NOT NULL DEFAULT '{hr}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_type),
  CHECK (array_length(levels, 1) BETWEEN 1 AND 5)
);
CREATE TRIGGER approval_chains_updated_at BEFORE UPDATE ON approval_chains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- Demandes d'absence ---------------------------------------------------------

CREATE TABLE absence_requests (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  employee_id          uuid NOT NULL REFERENCES employees (id),
  absence_type_id      uuid NOT NULL REFERENCES absence_types (id),
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  days_count           numeric(5, 2) NOT NULL CHECK (days_count > 0),
  reason               text,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  current_level        int NOT NULL DEFAULT 0,
  requested_by_user_id uuid REFERENCES users (id),
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  -- Un employé ne peut pas avoir deux absences actives qui se chevauchent.
  CONSTRAINT absence_requests_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status IN ('pending', 'approved'))
);
CREATE INDEX absence_requests_employee_idx
  ON absence_requests (tenant_id, employee_id, start_date DESC);
CREATE INDEX absence_requests_status_idx
  ON absence_requests (tenant_id, status, start_date);
CREATE TRIGGER absence_requests_updated_at BEFORE UPDATE ON absence_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- Visas (une ligne par décision de niveau) -----------------------------------

CREATE TABLE absence_approvals (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  request_id         uuid NOT NULL REFERENCES absence_requests (id),
  level              int NOT NULL,
  decision           text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  decided_by_user_id uuid NOT NULL REFERENCES users (id),
  comment            text,
  decided_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, level)
);
CREATE INDEX absence_approvals_request_idx ON absence_approvals (tenant_id, request_id);

-- --- RLS + audit + grants (patron standard) -------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['absence_types', 'holidays', 'absence_balances',
                           'approval_chains', 'absence_requests', 'absence_approvals']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_tenant_id())
         WITH CHECK (tenant_id = app_tenant_id())',
      t
    );
    EXECUTE format(
      'CREATE TRIGGER %I_audit
         AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION audit_row()',
      t, t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON absence_types TO app_user;
GRANT SELECT, INSERT, DELETE ON holidays TO app_user;
GRANT SELECT, INSERT, UPDATE ON absence_balances TO app_user;
GRANT SELECT, INSERT, UPDATE ON approval_chains TO app_user;
GRANT SELECT, INSERT, UPDATE ON absence_requests TO app_user;
GRANT SELECT, INSERT ON absence_approvals TO app_user;
