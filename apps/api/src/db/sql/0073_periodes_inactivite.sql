-- Les départs d'un agent, et ses retours.
--
-- Le dossier ne gardait que le DERNIER jour d'activité, effacé à la
-- réactivation : un agent parti six mois puis réintégré revenait sans trace
-- de son départ, et son ancienneté comptait les six mois. Chaque départ
-- devient une ligne : son dernier jour, son motif, et le jour de la reprise
-- quand il revient. L'ancienneté se compte hors de ces intervalles.
SET lock_timeout = '5s';

CREATE TABLE periodes_inactivite (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  employee_id   uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  dernier_jour  date NOT NULL,
  motif         text,
  -- Le premier jour de la reprise ; vide tant que l'agent n'est pas revenu.
  reprise_le    date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT periodes_inactivite_reprise_apres CHECK (reprise_le IS NULL OR reprise_le > dernier_jour + 1)
);

-- Un seul départ en cours par agent.
CREATE UNIQUE INDEX periodes_inactivite_une_ouverte
  ON periodes_inactivite (employee_id) WHERE reprise_le IS NULL;

ALTER TABLE periodes_inactivite ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodes_inactivite FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON periodes_inactivite
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER periodes_inactivite_audit
  AFTER INSERT OR UPDATE OR DELETE ON periodes_inactivite
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE, DELETE ON periodes_inactivite TO app_user;

-- Les inactifs d'aujourd'hui ont leur départ en cours. Les retours passés,
-- effacés par l'ancien geste, ne se reconstituent pas.
INSERT INTO periodes_inactivite (tenant_id, employee_id, dernier_jour, motif)
SELECT e.tenant_id, e.id,
       COALESCE(e.fin_activite, (e.archived_at AT TIME ZONE 'UTC')::date - 1),
       e.inactivite_motif
  FROM employees e
 WHERE e.status = 'archived'
   AND COALESCE(e.fin_activite, (e.archived_at AT TIME ZONE 'UTC')::date - 1) IS NOT NULL;
