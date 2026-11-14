-- Le dernier jour d'activité d'un agent inactif.
--
-- Décision APIX : la fiche d'un agent inactif dit quand son contrat a pris
-- fin, et sa dernière affectation s'arrête ce jour-là — pas « aujourd'hui ».
-- Pour une fin de contrat, c'est le dernier jour du contrat ; pour un départ
-- (démission, licenciement, retraite, décès), le jour où la DCH désactive le
-- dossier.
ALTER TABLE employees ADD COLUMN fin_activite date;

-- Les dossiers déjà inactifs : la fin de leur dernier contrat si elle
-- précède leur passage dans les inactifs, sinon ce jour-là.
UPDATE employees e
   SET fin_activite = (
     SELECT CASE
              WHEN d.fin IS NULL THEN COALESCE(e.archived_at::date, CURRENT_DATE)
              WHEN e.archived_at IS NULL THEN d.fin
              ELSE LEAST(d.fin, e.archived_at::date)
            END
       FROM (SELECT (SELECT c.end_date FROM contracts c
                      WHERE c.employee_id = e.id
                      ORDER BY c.start_date DESC, c.created_at DESC LIMIT 1) AS fin) d)
 WHERE e.status = 'archived';

-- Leur dernière affectation s'arrête ce jour-là (la borne haute est exclue).
UPDATE assignments a
   SET validity = daterange(lower(a.validity), e.fin_activite + 1)
  FROM employees e
 WHERE a.employee_id = e.id AND e.status = 'archived'
   AND lower(a.validity) <= e.fin_activite
   AND (upper_inf(a.validity) OR upper(a.validity) > e.fin_activite + 1);

ALTER TABLE employees
  ADD CONSTRAINT employees_fin_activite_si_inactif
    CHECK (status = 'archived' OR fin_activite IS NULL);
