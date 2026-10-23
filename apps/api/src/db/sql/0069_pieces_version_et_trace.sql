-- Les pièces du dossier : ce qu'on valide, et ce qu'on retire.
--
-- · version : chaque fichier déposé à la place du précédent la fait avancer.
--   Qui vérifie renvoie celle qu'il a ouverte : un fichier remplacé entre
--   sa lecture et son verdict ne se valide pas à son insu.
-- · journal : la pièce n'en avait pas (audit_row() aurait recopié les
--   octets du fichier). Celui-ci garde tout, sauf le contenu : dépôt,
--   remplacement, verdict, et surtout le retrait, avec son auteur.
SET lock_timeout = '5s';

ALTER TABLE employee_documents ADD COLUMN version integer NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION audit_piece() RETURNS trigger
LANGUAGE plpgsql AS
$$
DECLARE
  v_ref record;
BEGIN
  IF TG_OP = 'DELETE' THEN v_ref := OLD; ELSE v_ref := NEW; END IF;
  INSERT INTO audit_log (tenant_id, table_name, row_id, action, actor_user_id, old_data, new_data)
  VALUES (v_ref.tenant_id, TG_TABLE_NAME, v_ref.id, TG_OP, app_user_id(),
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'data' END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'data' END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER employee_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION audit_piece();
