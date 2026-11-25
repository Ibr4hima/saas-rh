-- La recherche d'un agent ignore la casse et les accents : « cisse » trouve
-- « Cissé », « N'Diaye » trouve « N’Diaye ». Une table de correspondance
-- plutôt que l'extension unaccent : rien à installer sur le serveur.
CREATE OR REPLACE FUNCTION sans_accents(texte text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(translate(texte,
    'ÀÁÂÃÄÅàáâãäåÆæÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöŒœÙÚÛÜùúûüÝýÿŸ’‘',
    'AAAAAAaaaaaaAaCcEEEEeeeeIIIIiiiiNnOOOOOoooooOoUUUUuuuuYyyY'''''))
$$;
