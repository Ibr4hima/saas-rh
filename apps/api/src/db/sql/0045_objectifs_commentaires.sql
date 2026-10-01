-- Les objectifs d'un semestre, vécus par l'agent puis évalués par son n+1.
--
-- Décision APIX : ce n'est pas au n+1 de cocher ce qui est fait — c'est à
-- l'agent, au fil de ses avancées ; le n+1 le voit à mesure. L'agent commente
-- ensuite chaque objectif (ce qu'il a fait, ce qui manque et pourquoi), au
-- brouillon, puis envoie ses commentaires à son n+1 — chaque objectif doit
-- l'être. Les objectifs ne changent plus. Le n+1 lit, commente à son tour
-- sous chaque objectif, donne l'appréciation globale (A à D) et valide.
SET lock_timeout = '5s';

ALTER TABLE objectifs_fiches
  -- Les cases que l'agent a cochées : { "<id du bloc>": true }.
  ADD COLUMN coches jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coches) = 'object'),
  -- Ses commentaires, objectif par objectif : { "<id du bloc>": "…" }.
  ADD COLUMN commentaires_agent jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(commentaires_agent) = 'object'),
  ADD COLUMN commentaires_envoyes_le timestamptz,
  -- Ceux du n+1, et sa note.
  ADD COLUMN commentaires_n1 jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(commentaires_n1) = 'object'),
  ADD COLUMN evaluation_note text CHECK (evaluation_note IN ('A', 'B', 'C', 'D')),
  ADD COLUMN evaluation_validee_le timestamptz,
  ADD COLUMN evaluateur_employee_id uuid REFERENCES employees (id) ON DELETE SET NULL,
  ADD CONSTRAINT objectifs_fiches_validee_apres_envoi
    CHECK (evaluation_validee_le IS NULL OR commentaires_envoyes_le IS NOT NULL),
  ADD CONSTRAINT objectifs_fiches_validee_notee
    CHECK (evaluation_validee_le IS NULL OR evaluation_note IS NOT NULL);

-- Les cases déjà cochées dans les fiches rejoignent les coches de l'agent.
UPDATE objectifs_fiches f
   SET coches = COALESCE((
     SELECT jsonb_object_agg(b ->> 'id', true)
       FROM jsonb_array_elements(f.contenu) b
      WHERE b ->> 'type' = 'checkListItem'
        AND b ->> 'id' IS NOT NULL
        AND (b -> 'props' ->> 'checked') = 'true'
   ), '{}'::jsonb);
