-- Le journal d'audit ne s'écrit plus que par ses déclencheurs (ADR-0288).
-- Ils tournaient avec les droits de l'appelant : le rôle de l'application
-- gardait l'INSERT sur audit_log, et pouvait y poser une entrée au nom de
-- n'importe quel compte de son organisation. Les quatre déclencheurs (les
-- lignes, les fiches d'objectifs, les pièces, les candidatures) tournent
-- désormais avec les droits de leur propriétaire, search_path figé ; le
-- rôle de l'application perd l'INSERT et garde la lecture de son
-- organisation. Chaque écriture métier laisse sa trace comme avant. Un
-- déclencheur d'audit ajouté plus tard devra être SECURITY DEFINER lui
-- aussi : sans cela, ses écritures échouent.
SET lock_timeout = '5s';

ALTER FUNCTION audit_row() SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION audit_fiche_objectifs() SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION audit_piece() SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION audit_candidature() SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;
REVOKE INSERT ON audit_log FROM app_user;
