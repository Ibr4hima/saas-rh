-- La Direction du Capital Humain, et ce qu'elle confie.
--
-- Le circuit des congés, décidé avec l'APIX : le n+1 de l'agent vise
-- d'abord ; la demande passe ensuite au DIRECTEUR DU CAPITAL HUMAIN — le
-- responsable de la direction marquée ici —, qui la traite ou la confie à un
-- membre de sa direction. Ce n'est plus un rôle qui décide, c'est
-- l'organigramme.

-- ——— La direction du personnel : une seule par organisation, et une direction.
ALTER TABLE org_units
  ADD COLUMN direction_du_personnel boolean NOT NULL DEFAULT false;
ALTER TABLE org_units
  ADD CONSTRAINT org_units_personnel_est_une_direction
  CHECK (NOT direction_du_personnel OR unit_type = 'direction');
CREATE UNIQUE INDEX org_units_une_direction_du_personnel
  ON org_units (tenant_id)
  WHERE direction_du_personnel AND deleted_at IS NULL;

-- Là où l'organigramme a déjà une direction abrégée « DCH », c'est elle.
UPDATE org_units o SET direction_du_personnel = true
 WHERE o.unit_type = 'direction' AND o.deleted_at IS NULL AND upper(o.short_name) = 'DCH'
   AND NOT EXISTS (SELECT 1 FROM org_units x
                    WHERE x.tenant_id = o.tenant_id AND x.direction_du_personnel);

-- ——— Les délégations du directeur du Capital Humain.
--
-- Une ligne par CHOIX d'un directeur, pour un type de demande : il confie à
-- un membre de sa direction (delegue_employee_id), ou il traite lui-même
-- (NULL). Le choix appartient à CE directeur : un nouveau DCH n'hérite pas du
-- choix de son prédécesseur, il fait le sien. Un choix remplacé est clos
-- (fin_at), jamais effacé : l'historique dit qui traitait quand.
CREATE TABLE delegations (
  id                    uuid PRIMARY KEY,
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  type_demande          text NOT NULL CHECK (type_demande IN ('conges')),
  directeur_employee_id uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  delegue_employee_id   uuid REFERENCES employees (id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  fin_at                timestamptz,
  CHECK (delegue_employee_id IS DISTINCT FROM directeur_employee_id)
);
CREATE UNIQUE INDEX delegations_un_choix_en_cours
  ON delegations (tenant_id, type_demande, directeur_employee_id)
  WHERE fin_at IS NULL;

ALTER TABLE delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delegations
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER delegations_audit
  AFTER INSERT OR UPDATE OR DELETE ON delegations
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE, DELETE ON delegations TO app_user;

-- ——— Une demande confiée à la main, une par une : elle va à cette personne
-- plutôt qu'à la règle générale. NULL : la règle s'applique.
ALTER TABLE absence_requests
  ADD COLUMN confiee_a_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL;

-- ——— Qui a visé POUR LE COMPTE de qui : « validée par X, par délégation du
-- directeur du Capital Humain ».
ALTER TABLE absence_approvals
  ADD COLUMN par_delegation_de uuid REFERENCES employees (id) ON DELETE SET NULL;
