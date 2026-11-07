-- Les dates d'évaluation n'ont plus d'année : un jour et un mois par
-- semestre, qui reviennent chaque année. Qui dirige la DCH les fixe. Sans
-- ligne, le 30 juin pour le 1er semestre et le 31 décembre pour le 2nd.
--
-- Remplace objective_review_dates (0103), une date par année : elle n'est
-- plus lue, et partira dans une version suivante (ADR-0010). Ce qu'on y avait
-- déplacé est repris ici : pour chaque semestre, la date de l'année la plus
-- récente donne son jour et son mois.
SET lock_timeout = '5s';

CREATE TABLE objective_review_schedule (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  s1_month    smallint NOT NULL,
  s1_day      smallint NOT NULL,
  s2_month    smallint NOT NULL,
  s2_day      smallint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objective_review_schedule_one UNIQUE (tenant_id),
  -- Un jour qui revient chaque année : le 29 février n'en est pas un.
  CONSTRAINT objective_review_schedule_s1 CHECK (
    s1_month BETWEEN 1 AND 12 AND s1_day >= 1 AND s1_day <=
      CASE WHEN s1_month = 2 THEN 28 WHEN s1_month IN (4, 6, 9, 11) THEN 30 ELSE 31 END),
  CONSTRAINT objective_review_schedule_s2 CHECK (
    s2_month BETWEEN 1 AND 12 AND s2_day >= 1 AND s2_day <=
      CASE WHEN s2_month = 2 THEN 28 WHEN s2_month IN (4, 6, 9, 11) THEN 30 ELSE 31 END),
  -- Le 1er semestre s'évalue avant le 2nd.
  CONSTRAINT objective_review_schedule_order
    CHECK ((s1_month, s1_day) < (s2_month, s2_day))
);

ALTER TABLE objective_review_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE objective_review_schedule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON objective_review_schedule
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER objective_review_schedule_audit
  AFTER INSERT OR UPDATE OR DELETE ON objective_review_schedule
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE ON objective_review_schedule TO app_user;

INSERT INTO objective_review_schedule (id, tenant_id, s1_month, s1_day, s2_month, s2_day)
SELECT gen_random_uuid(), r.tenant_id, r.s1_month, r.s1_day, r.s2_month, r.s2_day
  FROM (
    SELECT t.tenant_id,
           coalesce(extract(month FROM s1.review_date)::smallint, 6) AS s1_month,
           coalesce(extract(day FROM s1.review_date)::smallint, 30) AS s1_day,
           coalesce(extract(month FROM s2.review_date)::smallint, 12) AS s2_month,
           coalesce(extract(day FROM s2.review_date)::smallint, 31) AS s2_day
      FROM (SELECT DISTINCT tenant_id FROM objective_review_dates) t
      LEFT JOIN LATERAL (
        SELECT d.review_date FROM objective_review_dates d
         WHERE d.tenant_id = t.tenant_id AND d.semester = 1
         ORDER BY d.year DESC LIMIT 1) s1 ON true
      LEFT JOIN LATERAL (
        SELECT d.review_date FROM objective_review_dates d
         WHERE d.tenant_id = t.tenant_id AND d.semester = 2
         ORDER BY d.year DESC LIMIT 1) s2 ON true
  ) r
 -- Deux dates reprises d'années différentes peuvent se croiser : la date par
 -- défaut vaut alors.
 WHERE (r.s1_month, r.s1_day) < (r.s2_month, r.s2_day)
   AND NOT (r.s1_month = 2 AND r.s1_day = 29)
   AND NOT (r.s2_month = 2 AND r.s2_day = 29);
