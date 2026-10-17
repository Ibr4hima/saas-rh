-- APIX Academy — « Ma liste » : les formations qu'un compte garde de côté.
--
-- Un signet appartient au COMPTE, pas au dossier d'agent : c'est une commodité
-- de lecture, comme un marque-page, et un compte RH sans dossier doit pouvoir
-- en poser autant qu'un agent. La formation supprimée emporte ses signets.
-- Ni audit ni historique : retirer un signet, c'est l'oublier.

CREATE TABLE academy_bookmarks (
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES academy_courses (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);
CREATE INDEX academy_bookmarks_course_idx ON academy_bookmarks (course_id);

ALTER TABLE academy_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_bookmarks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON academy_bookmarks
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON academy_bookmarks TO app_user;
