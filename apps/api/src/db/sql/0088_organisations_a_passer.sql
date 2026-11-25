-- Le passage de minuit : chaque organisation, chaque nuit.
--
-- Les fins de contrat, les contrats qui commencent, les mots de passe à
-- effacer se rangent à minuit, sans attendre que quelqu'un ouvre la
-- plateforme. Le rôle applicatif ne voit aucune organisation hors de son
-- contexte (RLS) : cette fonction lui en donne la liste, rien d'autre. Il
-- passe ensuite dans le contexte de chacune, sous la RLS.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION organisations_a_passer() RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id FROM tenants ORDER BY created_at
$$;
REVOKE ALL ON FUNCTION organisations_a_passer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION organisations_a_passer() TO app_user;
