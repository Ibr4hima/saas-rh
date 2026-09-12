-- =============================================================================
-- 0004 — Portail employé : invitations à rejoindre l'espace de l'organisation.
-- Le token n'est JAMAIS stocké en clair (haché SHA-256, comme les sessions).
-- L'acceptation relie le compte créé au dossier via persons.user_id.
-- Expand-only. RLS forcée + audit + grants (ADR-0002/0008).
-- =============================================================================

SET lock_timeout = '5s';

CREATE TABLE invitations (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  person_id          uuid NOT NULL REFERENCES persons (id),
  email              text NOT NULL,
  role               text NOT NULL CHECK (role IN ('hr', 'payroll', 'manager', 'employee')),
  token_hash         text NOT NULL UNIQUE,
  invited_by_user_id uuid NOT NULL REFERENCES users (id),
  expires_at         timestamptz NOT NULL,
  accepted_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_person_idx ON invitations (tenant_id, person_id, created_at DESC);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
-- Lecture/écriture dans le tenant courant, comme toute table métier ; la
-- résolution PUBLIQUE d'un token (page d'acceptation, sans session) passe par
-- une policy dédiée sur le hash exact : sans contexte tenant, une ligne n'est
-- visible que si l'appelant présente le token correspondant.
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY token_lookup ON invitations FOR SELECT
  USING (token_hash = NULLIF(current_setting('app.invitation_token_hash', true), ''));
CREATE POLICY token_accept ON invitations FOR UPDATE
  USING (token_hash = NULLIF(current_setting('app.invitation_token_hash', true), ''))
  WITH CHECK (token_hash = NULLIF(current_setting('app.invitation_token_hash', true), ''));

CREATE TRIGGER invitations_audit
  AFTER INSERT OR UPDATE OR DELETE ON invitations
  FOR EACH ROW EXECUTE FUNCTION audit_row();

GRANT SELECT, INSERT, UPDATE ON invitations TO app_user;

-- L'acceptation (sans session) doit aussi pouvoir lire le tenant (nom de
-- l'organisation) et relier la personne : policies ciblées par le même token.
CREATE POLICY invitation_tenant_read ON tenants FOR SELECT
  USING (
    id IN (
      SELECT i.tenant_id FROM invitations i
      WHERE i.token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
    )
  );
CREATE POLICY invitation_person_read ON persons FOR SELECT
  USING (
    id IN (
      SELECT i.person_id FROM invitations i
      WHERE i.token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
    )
  );
CREATE POLICY invitation_person_link ON persons FOR UPDATE
  USING (
    id IN (
      SELECT i.person_id FROM invitations i
      WHERE i.token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
    )
  )
  WITH CHECK (
    id IN (
      SELECT i.person_id FROM invitations i
      WHERE i.token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
    )
  );
CREATE POLICY invitation_membership_insert ON user_tenant_memberships FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT i.tenant_id FROM invitations i
      WHERE i.token_hash = NULLIF(current_setting('app.invitation_token_hash', true), '')
    )
  );
