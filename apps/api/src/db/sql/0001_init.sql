-- =============================================================================
-- 0001 — Fondations : rôle applicatif, RLS, identités, organisation, audit.
-- Décisions appliquées : ADR-0002 (RLS forcée), ADR-0003 (effective dating),
-- ADR-0008 (audit append-only), ADR-0010 (conventions).
-- Migration expand-only : aucun DDL destructif.
-- =============================================================================

SET lock_timeout = '5s';

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- Rôle applicatif non-owner : la RLS ne s'applique PAS au propriétaire des
-- tables, donc le runtime se connecte exclusivement avec ce rôle (ADR-0002).
-- Le mot de passe ci-dessous est un défaut de DÉVELOPPEMENT : en staging/prod,
-- le runbook impose `ALTER ROLE app_user PASSWORD '...'` après provisionnement.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_dev_password';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_user;

-- Contexte applicatif : posé uniquement par SET LOCAL dans une transaction
-- (helper unique côté code). Lecture tolérante : absence de contexte => NULL
-- => les policies ne retournent AUCUNE ligne.
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Horodatage de mise à jour générique.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS
$$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- IDENTITÉS GLOBALES (non tenantées — cf. commentaires)
-- =============================================================================

-- Une personne physique qui se connecte. Volontairement SANS tenant_id : un
-- même compte peut appartenir à N organisations (futur multi-dossiers
-- expert-comptable). Table sans RLS : aucune donnée métier tenant, l'accès est
-- restreint aux colonnes nécessaires par la couche applicative.
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  given_name    text NOT NULL,
  family_name   text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  mfa_totp_secret text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Sessions serveur opaques (ADR-0009) : le token n'est JAMAIS stocké en clair.
-- Sans RLS : la résolution de session précède l'établissement du contexte tenant.
CREATE TABLE sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL, -- organisation active de la session
  token_hash text NOT NULL UNIQUE,
  ip         inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- =============================================================================
-- TENANTS ET APPARTENANCES
-- =============================================================================

CREATE TABLE tenants (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  slug         text NOT NULL UNIQUE,
  country_code char(2) NOT NULL DEFAULT 'SN',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_tenant_memberships (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  role       text NOT NULL CHECK (role IN ('admin', 'hr', 'payroll', 'manager', 'employee')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON user_tenant_memberships (user_id);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
-- Un tenant est visible s'il est le tenant courant, OU si l'utilisateur courant
-- en est membre (nécessaire au login : lister ses organisations avant d'avoir
-- un contexte tenant).
CREATE POLICY tenants_read ON tenants FOR SELECT
  USING (
    id = app_tenant_id()
    OR id IN (SELECT m.tenant_id FROM user_tenant_memberships m WHERE m.user_id = app_user_id())
  );
CREATE POLICY tenants_insert ON tenants FOR INSERT
  WITH CHECK (id = app_tenant_id());
CREATE POLICY tenants_update ON tenants FOR UPDATE
  USING (id = app_tenant_id())
  WITH CHECK (id = app_tenant_id());

ALTER TABLE user_tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_tenant_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_read ON user_tenant_memberships FOR SELECT
  USING (tenant_id = app_tenant_id() OR user_id = app_user_id());
CREATE POLICY memberships_write ON user_tenant_memberships FOR INSERT
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY memberships_update ON user_tenant_memberships FOR UPDATE
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY memberships_delete ON user_tenant_memberships FOR DELETE
  USING (tenant_id = app_tenant_id());

-- =============================================================================
-- ORGANISATION (directions / départements / services)
-- =============================================================================

CREATE TABLE org_units (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants (id),
  parent_id  uuid REFERENCES org_units (id),
  unit_type  text NOT NULL CHECK (unit_type IN ('direction', 'department', 'service')),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX org_units_tenant_idx ON org_units (tenant_id, parent_id);
CREATE TRIGGER org_units_updated_at BEFORE UPDATE ON org_units
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- PERSONNES ET EMPLOYÉS (Person ≠ User ≠ Employee, cf. ch. 03)
-- =============================================================================

CREATE TABLE persons (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  user_id        uuid REFERENCES users (id), -- lien facultatif vers un compte
  given_name     text NOT NULL,
  family_name    text NOT NULL,
  gender         text CHECK (gender IN ('female', 'male')),
  birth_date     date,
  personal_email text,
  phone          text,
  address_line   text,
  city           text,
  country_code   char(2) NOT NULL DEFAULT 'SN',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX persons_tenant_name_idx ON persons (tenant_id, family_name, given_name);
CREATE TRIGGER persons_updated_at BEFORE UPDATE ON persons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE employees (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  person_id       uuid NOT NULL REFERENCES persons (id),
  employee_number text NOT NULL,
  hired_on        date NOT NULL,
  status          text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'terminated')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_number)
);
CREATE INDEX employees_tenant_person_idx ON employees (tenant_id, person_id);
CREATE TRIGGER employees_updated_at BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Affectations effective-dated (ADR-0003) : poste + rattachement valides sur un
-- intervalle [valid_from, valid_to). Jamais d'UPDATE destructif : on clôt une
-- version et on en ouvre une autre. La contrainte GiST interdit tout
-- chevauchement pour un même employé.
CREATE TABLE assignments (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  employee_id    uuid NOT NULL REFERENCES employees (id),
  org_unit_id    uuid REFERENCES org_units (id),
  position_title text NOT NULL,
  validity       daterange NOT NULL CHECK (NOT isempty(validity)),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assignments_no_overlap
    EXCLUDE USING gist (tenant_id WITH =, employee_id WITH =, validity WITH &&)
);
CREATE INDEX assignments_employee_idx ON assignments (tenant_id, employee_id);

-- =============================================================================
-- RLS standard sur les tables tenantées
-- =============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_units', 'persons', 'employees', 'assignments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = app_tenant_id())
         WITH CHECK (tenant_id = app_tenant_id())',
      t
    );
  END LOOP;
END $$;

-- =============================================================================
-- AUDIT APPEND-ONLY (ADR-0008)
-- =============================================================================

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid,
  table_name    text NOT NULL,
  row_id        uuid,
  action        text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_user_id uuid,
  old_data      jsonb,
  new_data      jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_tenant_time_idx ON audit_log (tenant_id, occurred_at DESC);
CREATE INDEX audit_log_row_idx ON audit_log (table_name, row_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_log FOR SELECT
  USING (tenant_id = app_tenant_id());
CREATE POLICY audit_insert ON audit_log FOR INSERT
  WITH CHECK (tenant_id = app_tenant_id() OR tenant_id IS NULL);
-- Volontairement AUCUNE policy UPDATE/DELETE, et aucun GRANT correspondant :
-- append-only au niveau SQL pour le rôle applicatif.

-- NB : les champs sont lus via to_jsonb() car plpgsql résout OLD.x/NEW.x sur
-- le type record même dans une branche non prise (la table tenants n'a pas de
-- colonne tenant_id : son propre id fait office de tenant).
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql AS
$$
DECLARE
  v_new jsonb;
  v_old jsonb;
  v_ref jsonb;
  v_tenant uuid;
BEGIN
  IF TG_OP != 'DELETE' THEN
    v_new := to_jsonb(NEW);
  END IF;
  IF TG_OP != 'INSERT' THEN
    v_old := to_jsonb(OLD);
  END IF;
  v_ref := COALESCE(v_new, v_old);
  v_tenant := COALESCE(
    (v_ref ->> 'tenant_id')::uuid,
    CASE WHEN TG_TABLE_NAME = 'tenants' THEN (v_ref ->> 'id')::uuid END
  );

  INSERT INTO audit_log (tenant_id, table_name, row_id, action, actor_user_id, old_data, new_data)
  VALUES (v_tenant, TG_TABLE_NAME, (v_ref ->> 'id')::uuid, TG_OP, app_user_id(), v_old, v_new);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants', 'user_tenant_memberships', 'org_units',
                           'persons', 'employees', 'assignments']
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_audit
         AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION audit_row()',
      t, t
    );
  END LOOP;
END $$;

-- =============================================================================
-- GRANTS (explicites, table par table — pas de DEFAULT PRIVILEGES implicites)
-- =============================================================================

GRANT SELECT, INSERT, UPDATE ON users TO app_user;
GRANT SELECT, INSERT, UPDATE ON sessions TO app_user;
GRANT SELECT, INSERT, UPDATE ON tenants TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_tenant_memberships TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_units TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON persons TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON assignments TO app_user;
GRANT SELECT, INSERT ON audit_log TO app_user;
