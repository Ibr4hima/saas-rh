-- La fiche d'objectifs s'enregistre d'elle-même à chaque pause de frappe :
-- une ligne d'audit par pause, contenu complet avant et après, faisait d'une
-- séance d'écriture des centaines de copies de la fiche.
--
-- Le journal reste en ajout seul. Qui écrit une fiche y laisse au plus une
-- trace toutes les dix minutes : les enregistrements entre deux traces ne
-- sont que des états de frappe. Rien ne se perd : l'« avant » de chaque
-- trace contient tout ce qui a été écrit depuis la précédente, et le dernier
-- état est la fiche elle-même. Tout autre changement (envoi de
-- l'auto-évaluation, statuts, évaluation) se trace toujours.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION audit_fiche_objectifs() RETURNS trigger
LANGUAGE plpgsql AS
$$
DECLARE
  v_ref record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - 'contenu' - 'updated_at' - 'auteur_employee_id'
         = to_jsonb(OLD) - 'contenu' - 'updated_at' - 'auteur_employee_id'
     AND EXISTS (
       SELECT 1 FROM audit_log a
        WHERE a.table_name = TG_TABLE_NAME AND a.row_id = NEW.id
          AND a.actor_user_id IS NOT DISTINCT FROM app_user_id()
          AND a.occurred_at > now() - interval '10 minutes')
  THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN v_ref := OLD; ELSE v_ref := NEW; END IF;
  INSERT INTO audit_log (tenant_id, table_name, row_id, action, actor_user_id, old_data, new_data)
  VALUES (v_ref.tenant_id, TG_TABLE_NAME, v_ref.id, TG_OP, app_user_id(),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER objectifs_fiches_audit ON objectifs_fiches;
CREATE TRIGGER objectifs_fiches_audit
  AFTER INSERT OR UPDATE OR DELETE ON objectifs_fiches
  FOR EACH ROW EXECUTE FUNCTION audit_fiche_objectifs();
