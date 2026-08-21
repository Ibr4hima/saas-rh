-- =============================================================================
-- 0012 — Organigramme : abrégé des directions et règles de cohérence.
--
-- Trois incohérences étaient possibles et se sont vérifiées en pratique :
--   1. un même employé responsable de plusieurs unités ;
--   2. deux unités homonymes sous le même parent ;
--   3. un abrégé posé sur autre chose qu'une direction.
-- La hiérarchie des types (direction > département > service) et l'obligation
-- pour un responsable d'appartenir à l'unité qu'il dirige demandent de
-- remonter l'arbre : elles sont tenues côté applicatif, pas ici.
--
-- ATTENTION — ces index REFUSERAIENT une base existante. Les états qu'ils
-- interdisent étaient parfaitement légitimes jusqu'ici : c'est bien pour cela
-- qu'on les interdit. Vérifié sur une base de test, la création de l'index
-- avortait avec 23505 et la migration entière était annulée. La résorption est
-- donc faite ICI, avant de poser les contraintes, sinon le pilote APIX ne
-- pourrait pas migrer du tout.
-- =============================================================================

SET lock_timeout = '5s';

-- --- Résorption des états devenus illégitimes -------------------------------

-- Un employé ne dirigera plus qu'une unité : on garde celle où il travaille
-- réellement, à défaut la plus ancienne. Les autres perdent leur responsable et
-- la RH en désignera un nouveau.
WITH classees AS (
  SELECT o.id,
         row_number() OVER (
           PARTITION BY o.tenant_id, o.manager_employee_id
           ORDER BY (
             EXISTS (SELECT 1 FROM assignments a
                     WHERE a.employee_id = o.manager_employee_id
                       AND a.org_unit_id = o.id
                       AND a.validity @> CURRENT_DATE)
           ) DESC, o.created_at, o.id
         ) AS rang
  FROM org_units o
  WHERE o.manager_employee_id IS NOT NULL AND o.deleted_at IS NULL
)
UPDATE org_units o SET manager_employee_id = NULL
FROM classees c WHERE c.id = o.id AND c.rang > 1;

-- Unités sœurs homonymes : on les suffixe pour qu'elles restent distinguables.
WITH classees AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id,
                        COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
                        lower(name)
           ORDER BY created_at, id
         ) AS rang
  FROM org_units WHERE deleted_at IS NULL
)
UPDATE org_units o SET name = o.name || ' (' || c.rang || ')'
FROM classees c WHERE c.id = o.id AND c.rang > 1;

-- --- Contraintes ------------------------------------------------------------

-- Abrégé d'une direction : « DCH » pour « Direction du Capital Humain ».
ALTER TABLE org_units ADD COLUMN short_name text;

-- Un abrégé n'a de sens que pour une direction : les départements et services
-- se désignent par leur nom complet.
ALTER TABLE org_units
  ADD CONSTRAINT org_units_short_name_direction_only
  CHECK (short_name IS NULL OR unit_type = 'direction');

-- Un employé ne dirige qu'UNE unité. Sans cet index, la même personne pouvait
-- apparaître responsable de trois directions.
CREATE UNIQUE INDEX org_units_one_unit_per_manager
  ON org_units (tenant_id, manager_employee_id)
  WHERE manager_employee_id IS NOT NULL AND deleted_at IS NULL;

-- Un abrégé désigne une seule direction, quelle que soit la casse saisie.
CREATE UNIQUE INDEX org_units_short_name_unique
  ON org_units (tenant_id, upper(short_name))
  WHERE short_name IS NOT NULL AND deleted_at IS NULL;

-- Deux unités sœurs ne peuvent pas porter le même nom : personne ne saurait
-- les distinguer dans l'organigramme. Le sentinel remplace parent_id NULL,
-- que l'unicité SQL considérerait sinon comme toujours distinct.
CREATE UNIQUE INDEX org_units_sibling_name_unique
  ON org_units (
    tenant_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  WHERE deleted_at IS NULL;
