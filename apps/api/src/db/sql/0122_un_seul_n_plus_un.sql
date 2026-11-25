-- Un seul N+1, comme avant (ADR-0148).
--
-- L'ADR-0147 est abandonnée : le N+1 se désigne de nouveau comme avant
-- l'étape des deux N+1. La 0121 reste appliquée, car une migration appliquée
-- ne se supprime pas ; ses colonnes ne servent plus et partiront plus tard,
-- avec une migration qui se déclarera destructive (ADR-0010).
--
-- Une base qui a tourné avec les deux N+1 a vu sa chaîne recalculée : le N+1
-- d'avant la règle, gardé dans n1_avant_la_regle tant que la DCH ne l'avait
-- pas revu, reprend sa place. Ailleurs, cette colonne vaut le N+1 en place :
-- rien ne change.
SET lock_timeout = '5s';

UPDATE employees
   SET manager_employee_id = n1_avant_la_regle
 WHERE n1_avant_la_regle IS NOT NULL
   AND n1_avant_la_regle <> id
   AND manager_employee_id IS DISTINCT FROM n1_avant_la_regle;
