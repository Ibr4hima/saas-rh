-- Le N+2 à qui la fiche est envoyée (ADR-0289), gardé au moment de l'envoi.
-- Jusqu'ici, le N+2 se recalculait à chaque lecture, l'évaluateur de
-- l'évaluateur : un changement d'organigramme ou d'évaluateur faisait
-- passer une fiche envoyée, partie réservée comprise, à quelqu'un qui ne
-- l'avait jamais reçue, et la retirait à qui l'avait reçue. La grille de la
-- plateforme garde déjà son N+2 (n2_employee_id) ; la campagne fait pareil.
SET lock_timeout = '5s';

ALTER TABLE fiches_entretien
  ADD COLUMN envoyee_n2_a uuid REFERENCES employees (id) ON DELETE SET NULL;

-- Les fiches déjà envoyées : le N+2 qui a commenté, sinon le N+2 d'aujourd'hui,
-- en activité, comme la lecture le trouvait jusqu'ici.
UPDATE fiches_entretien f
   SET envoyee_n2_a = COALESCE(f.commentaires_n2_par, (
         SELECT n2.id
           FROM employees e
           JOIN employees n1 ON n1.id = COALESCE(f.evaluateur_employee_id, e.manager_employee_id)
           LEFT JOIN fiches_entretien f1 ON f1.employee_id = n1.id AND f1.annee = f.annee
           JOIN employees n2 ON n2.id = COALESCE(f1.evaluateur_employee_id, n1.manager_employee_id)
                            AND n2.status = 'active' AND n2.id <> e.id
          WHERE e.id = f.employee_id))
 WHERE f.envoyee_n2_le IS NOT NULL;

-- La migration 0147 marquait envoyée toute fiche déjà transmise à l'agent,
-- même sans N+2 : la lecture l'ignorait alors. Envoyée à personne, elle ne
-- l'a pas été.
UPDATE fiches_entretien SET envoyee_n2_le = NULL
 WHERE envoyee_n2_le IS NOT NULL AND envoyee_n2_a IS NULL;
