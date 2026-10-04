-- Le nombre de postes à pourvoir ne figure plus sur les offres : la colonne
-- ajoutée par 0056 est retirée, sa contrainte avec elle.
ALTER TABLE job_postings DROP COLUMN IF EXISTS nombre_postes;
