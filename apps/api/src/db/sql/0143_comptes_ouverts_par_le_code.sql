-- La connexion par code reconnaît chaque agent de la campagne par son
-- dossier (ADR-0246).
--
-- En campagne, l'adresse saisie se cherche aussi dans les dossiers : un agent
-- en activité dont le dossier porte cette adresse professionnelle et ce nom
-- de famille reçoit son code, avec ou sans compte. Sans compte, le compte
-- s'ouvre au premier code juste : la connexion en cours retient le
-- dossier à ouvrir, rien d'autre.
SET lock_timeout = '5s';

ALTER TABLE connexions_en_attente
  ADD COLUMN employee_id uuid REFERENCES employees (id) ON DELETE CASCADE;

-- Les dossiers des organisations sont hors de vue avant la connexion (RLS) :
-- la base dit quels dossiers portent cette adresse, par leur identifiant, et
-- rien d'autre. Le reste se lit dans le contexte de chaque organisation,
-- sous la RLS.
CREATE OR REPLACE FUNCTION dossiers_a_l_adresse(p_email text)
  RETURNS TABLE (tenant_id uuid, employee_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT e.tenant_id, e.id FROM employees e
   WHERE e.work_email IS NOT NULL AND lower(e.work_email) = lower(p_email)
$$;
REVOKE ALL ON FUNCTION dossiers_a_l_adresse(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION dossiers_a_l_adresse(text) TO app_user;

CREATE INDEX employees_work_email_idx ON employees (lower(work_email))
  WHERE work_email IS NOT NULL;
