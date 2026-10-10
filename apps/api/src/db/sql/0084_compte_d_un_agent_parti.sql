-- Le compte d'un agent parti.
--
-- Son portail reste ouvert, restreint, trente jours après son dernier jour.
-- Au-delà, son mot de passe s'efface : un compte sans mot de passe ne se
-- connecte plus. S'il revient, une invitation le lui fait choisir à nouveau,
-- sur le même compte : il retrouve tout ce qu'il y avait laissé.
SET lock_timeout = '5s';

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Le compte sert-il aussi dans une autre organisation ? Son mot de passe
-- vaut pour toutes : on ne l'efface pas pour un départ d'ici. Les
-- appartenances des autres organisations sont hors de vue (RLS) : la
-- question se pose ici, et la réponse n'en dit pas plus que oui ou non.
CREATE OR REPLACE FUNCTION compte_d_une_autre_organisation(p_user uuid) RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_tenant_memberships
     WHERE user_id = p_user AND tenant_id IS DISTINCT FROM app_tenant_id())
$$;
REVOKE ALL ON FUNCTION compte_d_une_autre_organisation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compte_d_une_autre_organisation(uuid) TO app_user;
