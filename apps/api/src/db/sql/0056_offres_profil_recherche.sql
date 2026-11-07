-- Le profil recherché d'une offre : niveau d'études, expérience minimum,
-- nombre de postes, langues exigées et, pour un CDD ou un stage, la durée.
-- Tout vient d'une liste fermée ; les contraintes la tiennent aussi en base.
-- Les offres existantes gardent un niveau et une expérience vides : on ne
-- leur invente pas un profil qu'elles n'ont jamais annoncé.
ALTER TABLE job_postings
  ADD COLUMN niveau_etudes text
    CHECK (niveau_etudes IN ('bac1', 'bac2', 'bac3', 'bac4', 'bac5', 'bac5plus')),
  ADD COLUMN experience_min smallint CHECK (experience_min IN (0, 1, 2, 3, 5, 7, 10)),
  ADD COLUMN nombre_postes smallint NOT NULL DEFAULT 1 CHECK (nombre_postes BETWEEN 1 AND 5),
  ADD COLUMN langues text[] NOT NULL DEFAULT '{}'
    CHECK (langues <@ ARRAY['fr', 'en', 'wo', 'ar', 'es', 'pt']::text[]),
  ADD COLUMN duree_mois smallint CHECK (duree_mois IN (3, 6, 12, 18, 24)),
  -- Une durée n'a de sens que pour un contrat qui en a une.
  ADD CONSTRAINT job_postings_duree_selon_contrat
    CHECK (duree_mois IS NULL OR contract_type IN ('cdd', 'stage'));
