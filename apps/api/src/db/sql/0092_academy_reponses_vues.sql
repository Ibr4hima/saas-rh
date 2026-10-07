-- Qui a vu les bonnes réponses d'une formation : la banque de questions à
-- l'atelier, une question écrite, un essai corrigé. Il les connaît : son
-- évaluation lui reste fermée, même une fois sa délégation à l'Academy
-- retirée.
--
-- Ni audit ni historique : une ligne s'écrit une fois, ne change jamais, et
-- s'en va avec le dossier de l'agent.
SET lock_timeout = '5s';

CREATE TABLE academy_reponses_vues (
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  employee_id  uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  course_id    uuid NOT NULL REFERENCES academy_courses (id) ON DELETE CASCADE,
  vues_le      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, course_id)
);
CREATE INDEX academy_reponses_vues_course_idx ON academy_reponses_vues (course_id);

ALTER TABLE academy_reponses_vues ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_reponses_vues FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON academy_reponses_vues
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT ON academy_reponses_vues TO app_user;
