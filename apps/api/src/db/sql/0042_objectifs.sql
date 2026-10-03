-- Les objectifs.
--
-- Décision APIX : trois niveaux, qui descendent l'organigramme.
--   · l'APIX — ses orientations, fixées par le directeur général et diffusées
--     à tous les agents ou aux directeurs seulement ;
--   · la direction — ses objectifs, fixés par le directeur général ;
--   · l'agent — ses objectifs individuels, fixés par son n+1 : un objectif
--     libre, ou une formation de l'APIX Academy à suivre, avec ou sans
--     échéance.
-- Un objectif appartient à une année. Qui l'a fixé l'évalue : atteint,
-- partiellement atteint, non atteint. Une formation s'évalue d'elle-même,
-- dans l'Academy.
SET lock_timeout = '5s';

CREATE TABLE objectifs (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  niveau              text NOT NULL CHECK (niveau IN ('apix', 'direction', 'individuel')),
  annee               integer NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
  -- L'APIX : à qui ses orientations sont diffusées.
  diffusion           text CHECK (diffusion IN ('tous', 'directeurs')),
  -- La direction dont c'est l'objectif.
  direction_id        uuid REFERENCES org_units (id) ON DELETE CASCADE,
  -- L'agent dont c'est l'objectif.
  employee_id         uuid REFERENCES employees (id) ON DELETE CASCADE,
  nature              text NOT NULL DEFAULT 'libre' CHECK (nature IN ('libre', 'formation')),
  -- Une formation de l'Academy ; son titre est gardé si elle est retirée.
  course_id           uuid REFERENCES academy_courses (id) ON DELETE SET NULL,
  titre               text NOT NULL CHECK (length(btrim(titre)) BETWEEN 2 AND 200),
  description         text CHECK (description IS NULL OR length(description) <= 2000),
  echeance            date,
  evaluation          text CHECK (evaluation IN ('atteint', 'partiel', 'non_atteint')),
  evalue_le           timestamptz,
  commentaire         text CHECK (commentaire IS NULL OR length(commentaire) <= 1000),
  auteur_employee_id  uuid REFERENCES employees (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objectifs_niveau_coherent CHECK (
    (niveau = 'apix') = (diffusion IS NOT NULL)
    AND (niveau = 'direction') = (direction_id IS NOT NULL)
    AND (niveau = 'individuel') = (employee_id IS NOT NULL)
  ),
  -- Seul l'objectif d'un agent peut être une formation à suivre.
  CONSTRAINT objectifs_formation_individuelle CHECK (nature = 'libre' OR niveau = 'individuel'),
  -- Une formation s'évalue dans l'Academy, pas à la main.
  CONSTRAINT objectifs_formation_sans_evaluation CHECK (nature = 'libre' OR evaluation IS NULL)
);

CREATE INDEX objectifs_agent ON objectifs (tenant_id, employee_id, annee) WHERE employee_id IS NOT NULL;
CREATE INDEX objectifs_direction ON objectifs (tenant_id, direction_id, annee) WHERE direction_id IS NOT NULL;
CREATE INDEX objectifs_apix ON objectifs (tenant_id, annee) WHERE niveau = 'apix';

ALTER TABLE objectifs ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectifs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON objectifs
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER objectifs_audit
  AFTER INSERT OR UPDATE OR DELETE ON objectifs
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE, DELETE ON objectifs TO app_user;
