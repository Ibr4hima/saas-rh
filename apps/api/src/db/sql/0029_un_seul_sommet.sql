-- Un seul sommet par organisation : la Direction Générale.
--
-- L'application le tient déjà (refus à l'écriture, sous verrou) ; l'index le
-- rend impossible à contourner — deux requêtes simultanées, un script, un
-- import. Son responsable est le directeur général : deux sommets, ce serait
-- deux « DG », et toute la chaîne remonterait vers l'un ou l'autre au hasard.
--
-- Une organisation qui en porte déjà deux (données d'avant la règle) n'est
-- pas cassée par la migration : l'index n'est posé que si AUCUNE n'est dans
-- ce cas. Le contrôle de la chaîne les signale (« sommets multiples »), et le
-- plus ancien fait foi en attendant qu'on range l'autre sous lui.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM org_units
     WHERE parent_id IS NULL AND deleted_at IS NULL
     GROUP BY tenant_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX org_units_un_seul_sommet
      ON org_units (tenant_id)
      WHERE parent_id IS NULL AND deleted_at IS NULL;
  END IF;
END
$$;
