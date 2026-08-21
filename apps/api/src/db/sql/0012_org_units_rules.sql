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
-- Expand-only. Aucune donnée existante n'est invalidée : short_name est NULL
-- partout, et les index uniques portent sur des colonnes déjà cohérentes.
-- =============================================================================

SET lock_timeout = '5s';

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
