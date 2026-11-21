-- L'évaluation annuelle sur la grille de l'APIX (ADR-0149).
--
-- Les objectifs ne se fixent plus dans l'application. Leurs tables restent,
-- inutilisées, jusqu'à une migration qui se déclarera destructive (ADR-0010) ;
-- leurs avis quittent les boîtes, leurs appels ne se relancent plus, et les
-- réglages de leurs sujets passent aux sujets de l'évaluation.
--
-- La fiche de l'agent dit « cadre » ou « non cadre » : la grille suit. Qui
-- dirige la DCH fixe la période d'évaluation de chaque année ; le N+1 remplit
-- la grille de chaque agent, qui circule jusqu'à la DCH.
SET lock_timeout = '5s';

ALTER TABLE employees
  ADD COLUMN personnel text CHECK (personnel IN ('cadre', 'non_cadre'));

-- La période d'évaluation d'une année, du … au ….
CREATE TABLE evaluation_periodes (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  annee       smallint NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
  du          date NOT NULL,
  au          date NOT NULL,
  -- L'avis d'ouverture aux N+1, parti une fois.
  ouverture_annoncee_le timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_periodes_une_par_annee UNIQUE (tenant_id, annee),
  CONSTRAINT evaluation_periodes_dans_l_ordre CHECK (du <= au)
);

ALTER TABLE evaluation_periodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_periodes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evaluation_periodes
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER evaluation_periodes_audit
  AFTER INSERT OR UPDATE OR DELETE ON evaluation_periodes
  FOR EACH ROW EXECUTE FUNCTION audit_row();
GRANT SELECT, INSERT, UPDATE ON evaluation_periodes TO app_user;

-- La grille d'un agent pour une année : ce que le N+1 y écrit (`contenu`),
-- l'identification figée à l'envoi, puis ce que l'agent et le N+2 y
-- ajoutent, et les dates de chaque étape.
CREATE TABLE evaluation_grilles (
  id                     uuid PRIMARY KEY,
  tenant_id              uuid NOT NULL REFERENCES tenants (id),
  employee_id            uuid NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
  annee                  smallint NOT NULL CHECK (annee BETWEEN 2000 AND 2100),
  modele                 text NOT NULL CHECK (modele IN ('cadre', 'non_cadre')),
  etat                   text NOT NULL DEFAULT 'brouillon'
                           CHECK (etat IN ('brouillon', 'chez_agent', 'validee_agent',
                                           'chez_n2', 'terminee')),
  contenu                jsonb NOT NULL DEFAULT '{}'::jsonb,
  identification         jsonb,
  evaluateur_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  envoyee_le             timestamptz,
  renvoi_mot             text CHECK (length(renvoi_mot) <= 500),
  renvoyee_le            timestamptz,
  commentaires_agent     text CHECK (length(commentaires_agent) <= 600),
  validee_agent_le       timestamptz,
  n2_employee_id         uuid REFERENCES employees (id) ON DELETE SET NULL,
  n2_identite            jsonb,
  envoyee_n2_le          timestamptz,
  commentaires_n2        text CHECK (length(commentaires_n2) <= 600),
  validee_n2_le          timestamptz,
  terminee_le            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evaluation_grilles_une_par_annee UNIQUE (tenant_id, employee_id, annee)
);
CREATE INDEX evaluation_grilles_annee ON evaluation_grilles (tenant_id, annee);
CREATE INDEX evaluation_grilles_n2 ON evaluation_grilles (n2_employee_id)
  WHERE n2_employee_id IS NOT NULL;

ALTER TABLE evaluation_grilles ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_grilles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON evaluation_grilles
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER evaluation_grilles_audit
  AFTER INSERT OR UPDATE OR DELETE ON evaluation_grilles
  FOR EACH ROW EXECUTE FUNCTION audit_row();
-- L'effacement définitif d'un agent emporte ses grilles.
GRANT SELECT, INSERT, UPDATE, DELETE ON evaluation_grilles TO app_user;

-- Les avis des objectifs quittent les boîtes ; leurs appels, renommés, ne se
-- relancent plus.
UPDATE notifications
   SET remplacee_le = coalesce(remplacee_le, now()),
       dedupe_key = replace(dedupe_key, ':appel:', ':appel-retire:')
 WHERE type = 'objectif' OR dedupe_key LIKE 'objectifs:%';

-- Les réglages de leurs sujets passent aux sujets de l'évaluation.
UPDATE notification_preferences SET sujet = 'evaluation' WHERE sujet = 'objectifs';
UPDATE notification_preferences SET sujet = 'equipe.evaluations'
 WHERE sujet = 'equipe.objectifs';
