-- Les années à venir qui n'ont jamais reçu leurs fêtes mobiles.
--
-- La migration 0020 a introduit les fériés SANS DATE et, pour ne pas faire
-- resurgir des jours volontairement supprimés, a marqué comme « déjà semée »
-- toute année portant au moins un férié :
--
--     INSERT INTO holiday_seeds SELECT DISTINCT tenant_id, year FROM holidays;
--
-- Ce rattrapage a marqué des années semées AVANT la fonctionnalité, donc
-- garnies des six dates civiles et de rien d'autre. Elles sont figées ainsi :
-- la marque empêche le socle d'y être posé, et les huit fêtes mobiles n'y
-- apparaîtront jamais. C'est exactement ce qu'on observe sur 2027 quand 2028,
-- ouverte plus tard, est complète.
--
-- On efface donc la marque de ces années-là, et l'application repose le socle
-- à la prochaine consultation — en sautant les libellés déjà présents, donc
-- sans dupliquer les six dates civiles.
--
-- Trois garde-fous, pour ne réparer QUE la signature de la panne :
--   · année strictement à venir — le passé et l'année courante ont pu être
--     mis en ordre à la main, on n'y touche pas ;
--   · aucune ligne sans date — dès qu'il y en a une, l'année a bien reçu le
--     socle et son état est celui que la RH a voulu ;
--   · exactement les six dates civiles et rien d'autre — un jour ajouté ou
--     un jour retiré signe une année curée, qu'on laisse telle quelle.
SET lock_timeout = '5s';

DELETE FROM holiday_seeds hs
WHERE hs.year > extract(year FROM now())
  AND NOT EXISTS (
    SELECT 1 FROM holidays h
    WHERE h.tenant_id = hs.tenant_id AND h.year = hs.year
      AND (h.day IS NULL OR h.fixed_date IS NOT TRUE)
  )
  AND (
    SELECT count(*) FROM holidays h
    WHERE h.tenant_id = hs.tenant_id AND h.year = hs.year
  ) = 6;
