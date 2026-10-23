-- Tout le monde est agent ; le reste s'acquiert par l'organigramme.
--
-- Décision APIX : plus de rôles « RH », « Manager » ou « Paie ». Un compte
-- est soit l'ADMINISTRATEUR (technique, hors organigramme), soit un AGENT.
-- Ce qu'un agent peut faire de plus lui vient de sa place : N+1 de son
-- équipe, directeur du Capital Humain — qui a tout —, ou membre de la DCH à
-- qui le directeur a confié une habilitation.

-- ——— Les rôles se ramènent à deux.
UPDATE user_tenant_memberships SET role = 'employee' WHERE role NOT IN ('admin', 'employee');
ALTER TABLE user_tenant_memberships DROP CONSTRAINT IF EXISTS user_tenant_memberships_role_check;
ALTER TABLE user_tenant_memberships
  ADD CONSTRAINT user_tenant_memberships_role_check CHECK (role IN ('admin', 'employee'));

UPDATE invitations SET role = 'employee' WHERE role <> 'employee';
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role = 'employee');

-- ——— Les habilitations confiées par le directeur du Capital Humain.
--
-- Une ligne par (membre, habilitation) accordée ; retirée, elle est close
-- (fin_at), jamais effacée : l'historique dit qui pouvait quoi, et quand.
-- Elles appartiennent à la DCH, pas au directeur qui les a données : quand
-- il change, elles restent.
CREATE TABLE habilitations (
  id                       uuid PRIMARY KEY,
  tenant_id                uuid NOT NULL REFERENCES tenants (id),
  capacite                 text NOT NULL,
  employee_id              uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  accordee_par_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  fin_at                   timestamptz,
  -- 'retiree' par le directeur, 'partie' quand le membre a quitté la DCH.
  fin_motif                text CHECK (fin_motif IN ('retiree', 'partie'))
);
CREATE UNIQUE INDEX habilitations_une_par_membre
  ON habilitations (tenant_id, capacite, employee_id) WHERE fin_at IS NULL;

ALTER TABLE habilitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE habilitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON habilitations
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER habilitations_audit
  AFTER INSERT OR UPDATE OR DELETE ON habilitations
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE, DELETE ON habilitations TO app_user;

-- ——— Les délégations de congés d'hier deviennent des habilitations.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id, created_at)
SELECT DISTINCT ON (d.tenant_id, d.delegue_employee_id)
       d.id, d.tenant_id, 'demandes.conges', d.delegue_employee_id, d.directeur_employee_id, d.created_at
  FROM delegations d
 WHERE d.fin_at IS NULL AND d.delegue_employee_id IS NOT NULL
 ORDER BY d.tenant_id, d.delegue_employee_id, d.created_at DESC;
DROP TABLE delegations;

-- ——— Toutes les demandes passent par la DCH : chacune peut être confiée, à
-- la main, à un membre. NULL : la règle s'applique (les membres habilités,
-- sinon le directeur).
ALTER TABLE document_requests
  ADD COLUMN confiee_a_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE profile_change_requests
  ADD COLUMN confiee_a_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL;
ALTER TABLE employee_documents
  ADD COLUMN confiee_a_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL;
