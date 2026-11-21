-- Les matricules provisoires de l'import (ADR-0181) : sans tiret, et la
-- lettre suit l'ancienneté. 50-A et 50-B deviennent 50A pour la personne
-- entrée la première, 50B pour la suivante. Chaque matricule garde ses
-- lettres : seul leur ordre change.
SET lock_timeout = '5s';

WITH provisoires AS (
  SELECT id, tenant_id, hired_on,
         substring(employee_number FROM '^(.+)-[A-Z]$') AS base,
         right(employee_number, 1) AS lettre
    FROM employees
   WHERE matricule_provisoire AND employee_number ~ '^.+-[A-Z]$'
),
par_anciennete AS (
  SELECT id, tenant_id, base,
         row_number() OVER (PARTITION BY tenant_id, base
                            ORDER BY hired_on NULLS LAST, lettre) AS rang
    FROM provisoires
),
par_lettre AS (
  SELECT tenant_id, base, lettre,
         row_number() OVER (PARTITION BY tenant_id, base ORDER BY lettre) AS rang
    FROM provisoires
),
nouveaux AS (
  SELECT a.id, a.tenant_id, a.base, a.base || l.lettre AS matricule
    FROM par_anciennete a
    JOIN par_lettre l USING (tenant_id, base, rang)
),
-- 50A peut déjà être le vrai matricule d'une autre personne : ce matricule
-- garde alors ses fiches telles quelles, la DCH les corrige sur la fiche.
bloques AS (
  SELECT DISTINCT n.tenant_id, n.base
    FROM nouveaux n
    JOIN employees e
      ON e.tenant_id = n.tenant_id AND upper(e.employee_number) = upper(n.matricule)
)
UPDATE employees e SET employee_number = n.matricule
  FROM nouveaux n
 WHERE e.id = n.id
   AND NOT EXISTS (
     SELECT 1 FROM bloques b WHERE b.tenant_id = n.tenant_id AND b.base = n.base);
