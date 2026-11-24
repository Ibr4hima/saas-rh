-- La campagne de fixation des objectifs (ADR-0274), en début d'année,
-- distincte de l'évaluation de fin d'année (ADR-0272).
--
-- Ses dates : une période par année, celle des objectifs qu'elle fixe.
-- Sur la fiche de cette année-là, le N+1 de l'organigramme écrit les
-- objectifs en brouillon, puis les transmet à l'agent. Transmis, ils
-- deviennent les objectifs de la fiche, ceux que l'évaluation de fin
-- d'année appréciera.
SET lock_timeout = '5s';

CREATE TABLE objectifs_periodes (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  annee       smallint NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
  du          date NOT NULL,
  au          date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objectifs_periodes_une_par_annee UNIQUE (tenant_id, annee),
  CONSTRAINT objectifs_periodes_dans_l_ordre CHECK (du <= au)
);

ALTER TABLE objectifs_periodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectifs_periodes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON objectifs_periodes
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER objectifs_periodes_audit
  AFTER INSERT OR UPDATE OR DELETE ON objectifs_periodes
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE ON objectifs_periodes TO app_user;

-- Le brouillon du N+1, qui les a écrits, et leur transmission à l'agent.
ALTER TABLE fiches_entretien
  ADD COLUMN objectifs_brouillon jsonb,
  ADD COLUMN objectifs_par_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD COLUMN objectifs_transmis_le timestamptz;
