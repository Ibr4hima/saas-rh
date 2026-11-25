-- Le profil recherché d'une offre (ADR-0182) : l'expérience pour le poste,
-- jamais au-dessus de l'expérience minimum, et, pour chaque langue exigée en
-- plus du français, son niveau à l'oral, à l'écrit et en compréhension
-- ({"en": {"oral": "courant", "ecrit": "intermediaire", ...}}). Les offres
-- existantes les gardent vides : on ne leur invente pas un profil qu'elles
-- n'ont jamais annoncé.
SET lock_timeout = '5s';

ALTER TABLE job_postings
  ADD COLUMN experience_poste smallint CHECK (experience_poste IN (0, 1, 2, 3, 5, 7, 10)),
  ADD COLUMN niveaux_langues jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(niveaux_langues) = 'object'),
  ADD CONSTRAINT job_postings_experience_poste_sous_le_minimum
    CHECK (experience_poste IS NULL OR experience_min IS NULL
           OR experience_poste <= experience_min);
