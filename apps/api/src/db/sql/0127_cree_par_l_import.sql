-- Ce que l'import a créé (ADR-0165) : les dossiers et les unités. « Vider
-- l'import », le bouton de l'administrateur, les retrouve par cette marque.
SET lock_timeout = '5s';

ALTER TABLE employees ADD COLUMN cree_par_l_import boolean NOT NULL DEFAULT false;
ALTER TABLE org_units ADD COLUMN cree_par_l_import boolean NOT NULL DEFAULT false;

-- Les imports faits avant cette marque la reçoivent aussi. Un import crée
-- tout dans une seule transaction, donc à la même heure (now() est l'heure
-- de la transaction), quand un dossier saisi à la main naît seul dans la
-- sienne : les dossiers nés à plusieurs dans la même transaction, et les
-- unités nées avec eux, viennent d'un import.
UPDATE employees e SET cree_par_l_import = true
 WHERE EXISTS (SELECT 1 FROM employees x
                WHERE x.tenant_id = e.tenant_id AND x.created_at = e.created_at
                  AND x.id <> e.id);

UPDATE org_units o SET cree_par_l_import = true
 WHERE o.unit_type <> 'direction'
   AND EXISTS (SELECT 1 FROM employees e
                WHERE e.cree_par_l_import AND e.tenant_id = o.tenant_id
                  AND e.created_at = o.created_at);
