-- =============================================================================
-- 0018 — Deux statuts pour un dossier, et de quoi l'effacer vraiment
--
-- Un dossier employé n'a que deux états qui intéressent la RH : l'agent est
-- là, ou il n'y est plus. « Suspendu » et « Sorti » disaient la même chose
-- deux fois sans que rien ne les distingue dans le produit — ils deviennent
-- « archivé ».
--
-- Archiver, c'est réversible : le dossier reste, le portail se ferme. Effacer,
-- c'est définitif : il ne doit rien rester. D'où les droits de suppression
-- ci-dessous, et surtout la fonction d'effacement du journal d'audit — sans
-- elle, « supprimer définitivement » serait un mensonge (cf. plus bas).
-- =============================================================================

-- ── Les deux statuts ─────────────────────────────────────────────────────────

UPDATE employees SET status = 'archived' WHERE status IN ('suspended', 'terminated');

-- La contrainte de 0002 énumérait les trois anciens statuts : on la remplace,
-- on ne l'empile pas — deux CHECK sur la même colonne se contrediraient.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;
ALTER TABLE employees
  ADD CONSTRAINT employees_status_check CHECK (status IN ('active', 'archived'));

-- Quand le dossier a été archivé : c'est cette date qui fait courir le délai
-- de conservation, et donc qui dira un jour qu'il faut l'effacer.
ALTER TABLE employees ADD COLUMN archived_at timestamptz;

UPDATE employees SET archived_at = updated_at WHERE status = 'archived';

-- ── Ce que l'effacement doit pouvoir vider ───────────────────────────────────
-- Chaque table qui porte quelque chose DE la personne. Les droits sont donnés
-- un par un, comme partout ailleurs dans ce schéma : jamais en bloc.

GRANT DELETE ON absence_requests TO app_user;
GRANT DELETE ON absence_approvals TO app_user;
GRANT DELETE ON absence_balances TO app_user;
GRANT DELETE ON document_requests TO app_user;
GRANT DELETE ON profile_change_requests TO app_user;
GRANT DELETE ON invitations TO app_user;
-- Une session porte l'adresse IP et le navigateur : la révoquer ne suffit pas
-- à effacer la personne, il faut pouvoir la retirer.
GRANT DELETE ON sessions TO app_user;

-- ── Un compte peut être vidé sans être détruit ───────────────────────────────
--
-- Effacer la LIGNE `users` d'un agent qui a validé des congés ou déposé une
-- pièce au dossier d'un collègue casserait ces dossiers-là : ils désignent son
-- compte. On garde donc la ligne et on la vide de son contenu — l'identifiant,
-- le nom et le mot de passe partent, la référence tient. Il lui faut un statut
-- qui dise ce qu'elle est devenue ; « suspendu » dirait qu'elle peut revenir.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'deleted'));

-- ── Le journal d'audit, et pourquoi il ne se supprime toujours pas ───────────
--
-- Le déclencheur `audit_row()` copie la ligne ENTIÈRE dans `old_data` à chaque
-- suppression. Effacer un dossier sans toucher au journal laisserait donc une
-- copie complète de la personne — date de naissance, adresse, pièce d'identité
-- chiffrée — dans la table même qu'on ne peut pas purger. L'effacement serait
-- apparent, pas réel.
--
-- La réponse n'est pas d'ouvrir le journal à la suppression : un journal
-- réécrivable ne prouve plus rien. On retire donc le CONTENU en laissant la
-- TRACE — quelle table, quelle ligne, quelle action, par qui, quand. Ce qui
-- s'est passé reste démontrable ; ce qui a été dit de la personne disparaît.
--
-- SECURITY DEFINER : l'application ne reçoit pas le droit d'UPDATE sur le
-- journal, seulement celui d'appeler cette fonction-ci, qui ne sait faire que
-- cela. Elle s'exécute donc hors RLS — d'où le filtre de tenant écrit à la
-- main, sans quoi elle franchirait la frontière qu'elle est censée respecter.
CREATE OR REPLACE FUNCTION erase_audit_payload(p_row_ids uuid[]) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant uuid := app_tenant_id();
  n integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'erase_audit_payload : aucun tenant dans le contexte';
  END IF;
  UPDATE audit_log
     SET old_data = NULL, new_data = NULL
   WHERE tenant_id = v_tenant
     AND row_id = ANY (p_row_ids)
     AND (old_data IS NOT NULL OR new_data IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION erase_audit_payload(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erase_audit_payload(uuid[]) TO app_user;
