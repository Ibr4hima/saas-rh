-- Les langues qu'une offre peut exiger deviennent : anglais, mandarin,
-- espagnol, arabe, italien. Celles qui ne sont plus proposées (français,
-- wolof, portugais) sont retirées des offres qui les portaient.
ALTER TABLE job_postings DROP CONSTRAINT IF EXISTS job_postings_langues_check;
UPDATE job_postings
   SET langues = ARRAY(SELECT l FROM unnest(langues) AS l
                        WHERE l IN ('en', 'zh', 'es', 'ar', 'it'))
 WHERE NOT (langues <@ ARRAY['en', 'zh', 'es', 'ar', 'it']::text[]);
ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_langues_check
    CHECK (langues <@ ARRAY['en', 'zh', 'es', 'ar', 'it']::text[]);
