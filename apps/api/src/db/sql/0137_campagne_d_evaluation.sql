-- La campagne d'évaluation annuelle (ADR-0211), sur la fiche S1/EN05
-- (ADR-0205).
--
-- La période gagne la fin de l'auto-évaluation : l'agent la fait du début
-- de la période à ce jour-là, puis le N+1 évalue jusqu'à la fin de la
-- période.
--
-- La fiche d'un agent pour une année porte son auto-évaluation, et
-- l'évaluateur de la campagne quand l'administration le choisit : sinon,
-- c'est le N+1 de l'organigramme. Ce choix ne touche pas à l'organigramme
-- ni à ses règles.
SET lock_timeout = '5s';

ALTER TABLE evaluation_periodes
  ADD COLUMN auto_au date,
  ADD CONSTRAINT evaluation_periodes_auto_dans_la_periode
    CHECK (auto_au IS NULL OR (auto_au >= du AND auto_au <= au));

CREATE TABLE fiches_entretien (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants (id),
  employee_id            uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  annee                  smallint NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
  -- L'évaluateur choisi par l'administration ; vide, le N+1 de l'organigramme.
  evaluateur_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  -- L'auto-évaluation de l'agent, puis le jour de sa transmission au N+1.
  auto                   jsonb,
  auto_transmise_le      timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fiches_entretien_une_par_annee UNIQUE (tenant_id, employee_id, annee),
  CONSTRAINT fiches_entretien_pas_soi_meme
    CHECK (evaluateur_employee_id IS DISTINCT FROM employee_id)
);
CREATE INDEX fiches_entretien_evaluateur ON fiches_entretien (tenant_id, annee, evaluateur_employee_id)
  WHERE evaluateur_employee_id IS NOT NULL;

ALTER TABLE fiches_entretien ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiches_entretien FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON fiches_entretien
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER fiches_entretien_audit
  AFTER INSERT OR UPDATE OR DELETE ON fiches_entretien
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE ON fiches_entretien TO app_user;
