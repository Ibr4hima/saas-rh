-- Un titre d'identité déposé à nouveau : renouvellement, ou la même pièce ?
--
-- Décision APIX : l'agent qui dépose une CNI ou un passeport alors qu'il y en
-- a déjà un à son dossier dit s'il s'agit d'un renouvellement. Qui vérifie
-- sait alors quoi faire : comparer le document aux informations de la fiche,
-- ou saisir celles de la nouvelle pièce, qui remplacent les anciennes.
SET lock_timeout = '5s';

ALTER TABLE employee_documents
  ADD COLUMN renouvellement boolean NOT NULL DEFAULT false;
