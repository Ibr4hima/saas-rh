-- « Mission » et « Absence ponctuelle » ne sont plus des types d'absence de
-- l'application (ADR-0166). Ils se retirent comme la DCH retire un type : la
-- ligne reste, pour les demandes passées qui la désignent. Un type qu'une
-- demande en attente de visa porte encore reste en service, le temps qu'elle
-- aboutisse : la DCH le retire ensuite dans les paramètres des absences.
SET lock_timeout = '5s';

UPDATE absence_types a SET deleted_at = now()
 WHERE a.name IN ('Mission', 'Absence ponctuelle')
   AND a.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM absence_requests r
                    WHERE r.absence_type_id = a.id AND r.status = 'pending');
