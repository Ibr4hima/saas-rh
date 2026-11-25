-- Les notes des objectifs passent de 0-3 à 1-4 (ADR-0276). Une note déjà
-- écrite, dans l'auto-évaluation comme dans l'évaluation du N+1, monte d'un
-- cran et garde son sens : 3, Dépassé, devient 4 ; 0, Non réalisé,
-- devient 1. Les lettres d'avant les notes (A à D) ne bougent pas : elles
-- se relisent à la volée, A en 4 jusqu'à D en 1.
SET lock_timeout = '5s';

UPDATE fiches_entretien f
   SET auto = jsonb_set(f.auto, '{objectifs}', (
         SELECT jsonb_object_agg(
                  e.k,
                  CASE WHEN jsonb_typeof(e.v -> 'note') = 'number'
                       THEN jsonb_set(e.v, '{note}', to_jsonb((e.v ->> 'note')::int + 1))
                       ELSE e.v END)
           FROM jsonb_each(f.auto -> 'objectifs') AS e(k, v)))
 WHERE jsonb_typeof(f.auto -> 'objectifs') = 'object'
   AND EXISTS (SELECT 1 FROM jsonb_each(f.auto -> 'objectifs') AS e(k, v)
                WHERE jsonb_typeof(e.v -> 'note') = 'number');

UPDATE fiches_entretien f
   SET evaluation = jsonb_set(f.evaluation, '{objectifs}', (
         SELECT jsonb_object_agg(
                  e.k,
                  CASE WHEN jsonb_typeof(e.v -> 'note') = 'number'
                       THEN jsonb_set(e.v, '{note}', to_jsonb((e.v ->> 'note')::int + 1))
                       ELSE e.v END)
           FROM jsonb_each(f.evaluation -> 'objectifs') AS e(k, v)))
 WHERE jsonb_typeof(f.evaluation -> 'objectifs') = 'object'
   AND EXISTS (SELECT 1 FROM jsonb_each(f.evaluation -> 'objectifs') AS e(k, v)
                WHERE jsonb_typeof(e.v -> 'note') = 'number');
