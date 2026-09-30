-- La fiche d'objectifs d'un agent, pour une année.
--
-- Décision APIX : le n+1 n'aligne plus une liste d'objectifs ; il rédige,
-- dans un éditeur de blocs, la fiche de son direct — des titres, des cases à
-- cocher, des échéances, des formations de l'APIX Academy à suivre. La fiche
-- se garde telle que l'éditeur la produit (ses blocs, en JSON) : l'agent la
-- lit dans « Mes objectifs », son n+1 la tient à jour.
SET lock_timeout = '5s';

CREATE TABLE objectifs_fiches (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  employee_id         uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  annee               integer NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
  contenu             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(contenu) = 'array'),
  -- Qui l'a mise à jour en dernier.
  auteur_employee_id  uuid REFERENCES employees (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objectifs_fiches_une_par_annee UNIQUE (tenant_id, employee_id, annee)
);

ALTER TABLE objectifs_fiches ENABLE ROW LEVEL SECURITY;
ALTER TABLE objectifs_fiches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON objectifs_fiches
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER objectifs_fiches_audit
  AFTER INSERT OR UPDATE OR DELETE ON objectifs_fiches
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE, DELETE ON objectifs_fiches TO app_user;
