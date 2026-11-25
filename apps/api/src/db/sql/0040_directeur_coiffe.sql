-- Le directeur coiffe sa direction.
--
-- Décision APIX : dans une direction qui a sa tête, qui n'a pas de n+1
-- relève d'office du directeur ; qui en a un le garde, et le directeur est
-- au bout de sa chaîne. À la Direction Générale, c'est le DG ; un directeur,
-- lui, relève du DG. Le serveur l'applique désormais à chaque écriture ; ici,
-- les dossiers déjà enregistrés sans n+1.
--
-- Mêmes définitions que chaine.ts : le sommet est la plus ancienne unité
-- racine vivante de chaque organisation ; l'unité d'un agent est celle de
-- l'affectation en cours, sinon de la prochaine ; sa direction, la plus
-- proche direction au-dessus.
WITH RECURSIVE
sommets AS (
  SELECT DISTINCT ON (tenant_id) tenant_id, id, manager_employee_id AS dg
    FROM org_units
   WHERE parent_id IS NULL AND deleted_at IS NULL
   ORDER BY tenant_id, created_at, id
),
sans_n1 AS (
  SELECT e.id, e.tenant_id,
         (SELECT av.org_unit_id FROM assignments av
           WHERE av.employee_id = e.id
             AND (av.validity @> CURRENT_DATE OR lower(av.validity) > CURRENT_DATE)
           ORDER BY lower(av.validity) LIMIT 1) AS unite
    FROM employees e
   WHERE e.status = 'active' AND e.manager_employee_id IS NULL
),
remontee AS (
  SELECT s.id AS agent, o.id, o.parent_id, o.unit_type, o.manager_employee_id, 0 AS prof
    FROM sans_n1 s JOIN org_units o ON o.id = s.unite AND o.deleted_at IS NULL
  UNION ALL
  SELECT r.agent, o.id, o.parent_id, o.unit_type, o.manager_employee_id, r.prof + 1
    FROM remontee r JOIN org_units o ON o.id = r.parent_id AND o.deleted_at IS NULL
   WHERE r.prof < 64
),
directions AS (
  SELECT DISTINCT ON (agent) agent, manager_employee_id AS tete
    FROM remontee WHERE unit_type = 'direction'
   ORDER BY agent, prof
),
cibles AS (
  SELECT s.id AS agent,
         CASE
           WHEN s.id = so.dg THEN NULL
           WHEN EXISTS (SELECT 1 FROM org_units od
                         WHERE od.manager_employee_id = s.id AND od.unit_type = 'direction'
                           AND od.deleted_at IS NULL AND od.id <> so.id)
             THEN so.dg
           WHEN d.tete <> s.id THEN d.tete
         END AS n1
    FROM sans_n1 s
    JOIN sommets so ON so.tenant_id = s.tenant_id
    LEFT JOIN directions d ON d.agent = s.id
)
UPDATE employees e
   SET manager_employee_id = c.n1, updated_at = now()
  FROM cibles c
  JOIN employees resp ON resp.id = c.n1 AND resp.status = 'active'
 WHERE e.id = c.agent
   -- Jamais de boucle : le responsable ne doit pas relever, de près ou de
   -- loin, de l'agent qu'on lui rattache.
   AND NOT EXISTS (
     WITH RECURSIVE chaine AS (
       SELECT resp.manager_employee_id AS id
       UNION
       SELECT x.manager_employee_id FROM employees x JOIN chaine ch ON x.id = ch.id
     )
     SELECT 1 FROM chaine WHERE chaine.id = e.id
   );
