-- Les dates d'évaluation de l'année, une par semestre : les notes de A à D se
-- donnent à ces dates-là. Qui dirige la DCH les fixe. Sans ligne, la date par
-- défaut vaut : le 30 juin pour le 1er semestre, le 31 décembre pour le 2nd.
-- Une ligne n'existe que pour une date déplacée.
SET lock_timeout = '5s';

CREATE TABLE objective_review_dates (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  year        integer NOT NULL,
  semester    smallint NOT NULL
    CONSTRAINT objective_review_dates_semester CHECK (semester IN (1, 2)),
  review_date date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objective_review_dates_in_year
    CHECK (extract(year FROM review_date)::integer = year),
  CONSTRAINT objective_review_dates_one UNIQUE (tenant_id, year, semester)
);

ALTER TABLE objective_review_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE objective_review_dates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON objective_review_dates
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER objective_review_dates_audit
  AFTER INSERT OR UPDATE OR DELETE ON objective_review_dates
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE ON objective_review_dates TO app_user;
