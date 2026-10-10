-- L'auto-évaluation : l'agent ne coche plus, il dit où en est chaque objectif.
--
-- Décision APIX : sous chaque objectif, l'agent choisit Atteint, Partiellement
-- ou Non atteint — la case en prend la couleur (bleu, jaune, rouge) ; son n+1
-- le voit à mesure. Chaque objectif doit avoir le sien, et son commentaire,
-- avant l'envoi au n+1.
SET lock_timeout = '5s';

ALTER TABLE objectifs_fiches
  -- { "<id du bloc>": "atteint" | "partiel" | "non_atteint" }.
  ADD COLUMN statuts jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(statuts) = 'object')
    CHECK (NOT jsonb_path_exists(
      statuts, '$.* ? (@ != "atteint" && @ != "partiel" && @ != "non_atteint")'));

-- Ce que l'agent avait coché était atteint.
UPDATE objectifs_fiches
   SET statuts = COALESCE((SELECT jsonb_object_agg(k, 'atteint') FROM jsonb_object_keys(coches) k),
                          '{}'::jsonb);

ALTER TABLE objectifs_fiches DROP COLUMN coches;
