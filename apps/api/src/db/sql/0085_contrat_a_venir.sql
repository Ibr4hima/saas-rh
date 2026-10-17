-- Un contrat qui commence plus tard.
--
-- Il porte la place où l'agent prendra son poste : elle ne s'applique que le
-- jour où il commence, pas avant. Entre la fin d'un contrat et le début du
-- suivant, l'agent n'est plus sous contrat : son dossier passe dans les
-- inactifs, son portail est restreint ; ce jour-là, tout lui revient.
SET lock_timeout = '5s';

ALTER TABLE contracts
  ADD COLUMN planned_position_title text,
  ADD COLUMN planned_org_unit_id uuid REFERENCES org_units (id);

-- Les contrats déjà enregistrés qui n'ont pas commencé : la place de la
-- dernière affectation de l'agent, celle qu'il aurait gardée.
UPDATE contracts c
   SET planned_position_title = a.position_title, planned_org_unit_id = a.org_unit_id
  FROM (SELECT DISTINCT ON (employee_id) employee_id, position_title, org_unit_id
          FROM assignments
         ORDER BY employee_id, lower(validity) DESC) a
 WHERE a.employee_id = c.employee_id AND c.start_date > CURRENT_DATE;

-- L'invitation qui part d'elle-même, le jour où le contrat d'un agent parti
-- depuis plus de trente jours commence : personne ne l'envoie.
ALTER TABLE invitations ALTER COLUMN invited_by_user_id DROP NOT NULL;
