-- APIX Academy : le formateur d'une formation, et qui la gère.
--
-- Décision APIX : qui a eu la main sur une formation dans l'atelier en
-- connaît les questions — l'évaluation lui est fermée. Le formateur, lui,
-- peut la suivre et même passer l'évaluation, mais elle ne lui donne pas de
-- certificat ; son dossier dit qu'il en est le formateur.

-- ——— Le formateur : un agent de l'APIX (son dossier), ou une personne
-- extérieure (son nom seul). Le nom est gardé dans les deux cas : c'est lui
-- que la formation affiche.
ALTER TABLE academy_courses
  ADD COLUMN formateur_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD COLUMN formateur_nom text,
  ADD CONSTRAINT academy_courses_formateur_nomme
    CHECK (formateur_employee_id IS NULL OR formateur_nom IS NOT NULL);

-- ——— Qui a eu la main sur une formation dans l'atelier — l'a créée, en a
-- ouvert la banque de questions, en a essayé l'évaluation. Une fois inscrit,
-- on le reste : perdre l'habilitation n'efface pas ce qu'on a vu.
CREATE TABLE academy_course_gestionnaires (
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  course_id        uuid NOT NULL REFERENCES academy_courses (id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  premier_acces_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, employee_id)
);
ALTER TABLE academy_course_gestionnaires ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_course_gestionnaires FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON academy_course_gestionnaires
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON academy_course_gestionnaires TO app_user;

-- Qui a créé une formation l'a eue en main.
INSERT INTO academy_course_gestionnaires (tenant_id, course_id, employee_id, premier_acces_at)
SELECT c.tenant_id, c.id, e.id, c.created_at
  FROM academy_courses c
  JOIN persons p ON p.user_id = c.created_by_user_id
  JOIN employees e ON e.person_id = p.id
ON CONFLICT DO NOTHING;
