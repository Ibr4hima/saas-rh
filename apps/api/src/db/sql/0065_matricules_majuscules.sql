-- Un matricule s'écrit en capitales : « apix-0001 » et « APIX-0001 » sont le
-- même agent. Les matricules en place passent en capitales, et l'unicité ne
-- tient plus compte de la casse, même pour une écriture faite hors de l'API.
SET lock_timeout = '5s';

-- Deux dossiers que seule la casse distingue : la migration s'arrête et les
-- nomme plutôt que de choisir lequel garde son matricule.
DO $$
DECLARE doublons text;
BEGIN
  SELECT string_agg(matricule, ', ') INTO doublons
    FROM (SELECT upper(employee_number) AS matricule FROM employees
           GROUP BY tenant_id, upper(employee_number) HAVING count(*) > 1) d;
  IF doublons IS NOT NULL THEN
    RAISE EXCEPTION 'Matricules en double selon la casse : %', doublons;
  END IF;
END $$;

UPDATE employees SET employee_number = upper(employee_number)
 WHERE employee_number <> upper(employee_number);

CREATE UNIQUE INDEX employees_matricule_sans_casse
  ON employees (tenant_id, upper(employee_number));

-- Les alertes de fin d'un contrat déjà renouvelé ne disent plus rien de vrai.
DELETE FROM notifications n
 WHERE n.type = 'contract_deadline'
   AND EXISTS (
     SELECT 1 FROM contracts c
       JOIN contracts suivant
         ON suivant.employee_id = c.employee_id AND suivant.start_date > c.start_date
      WHERE n.dedupe_key LIKE 'contract_deadline:' || c.id || '%');
