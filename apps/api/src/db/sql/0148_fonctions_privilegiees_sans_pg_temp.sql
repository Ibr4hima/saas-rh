-- Les fonctions SECURITY DEFINER (ADR-0288) tournent avec les droits de
-- leur propriétaire. Leur search_path disait « public » seul : PostgreSQL
-- cherche alors d'abord dans le schéma temporaire de la session, où le rôle
-- de l'application peut créer une table du même nom qu'une table lue par la
-- fonction. pg_catalog en tête et pg_temp en dernier : la fonction ne lit
-- que les vraies tables. Une fonction réécrite plus tard garde ce réglage
-- (tests/fonctions-privilegiees.spec.ts le vérifie pour toutes).
SET lock_timeout = '5s';

ALTER FUNCTION erase_audit_payload(uuid[]) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION outbound_email_tenants() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION compte_d_une_autre_organisation(uuid) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION organisations_a_passer() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION dossiers_a_l_adresse(text) SET search_path = pg_catalog, public, pg_temp;
