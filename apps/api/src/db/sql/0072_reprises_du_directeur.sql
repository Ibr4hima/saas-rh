-- Le directeur du Capital Humain reprend une demande en se la confiant. S'il
-- cesse de diriger la DCH (successeur, autre direction désignée, unité
-- retirée), ses reprises tombent : les demandes reviennent au circuit commun
-- au lieu de lui rester comme à un membre ordinaire. Un déclencheur, parce
-- que la tête de la DCH change par plusieurs chemins (organigramme, départ,
-- reprise d'équipe).
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION liberer_les_reprises_du_directeur() RETURNS trigger
LANGUAGE plpgsql AS
$$
DECLARE
  ancien uuid := OLD.manager_employee_id;
BEGIN
  IF NOT OLD.direction_du_personnel OR ancien IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.direction_du_personnel AND NEW.deleted_at IS NULL
     AND NEW.manager_employee_id IS NOT DISTINCT FROM ancien THEN
    RETURN NEW;
  END IF;
  UPDATE absence_requests SET confiee_a_employee_id = NULL
   WHERE confiee_a_employee_id = ancien AND status = 'pending';
  UPDATE document_requests SET confiee_a_employee_id = NULL
   WHERE confiee_a_employee_id = ancien AND status IN ('received', 'processing');
  UPDATE profile_change_requests SET confiee_a_employee_id = NULL
   WHERE confiee_a_employee_id = ancien AND status = 'pending';
  UPDATE employee_documents SET confiee_a_employee_id = NULL
   WHERE confiee_a_employee_id = ancien AND status = 'pending';
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_units_reprises_du_directeur
  AFTER UPDATE OF manager_employee_id, direction_du_personnel, deleted_at ON org_units
  FOR EACH ROW EXECUTE FUNCTION liberer_les_reprises_du_directeur();
