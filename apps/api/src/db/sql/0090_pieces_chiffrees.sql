-- Les pièces des dossiers, chiffrées au repos.
--
-- Les pièces des agents (CNI, passeport, diplômes, CV) et les justificatifs
-- d'absence (un certificat médical) étaient gardés en clair : qui lisait la
-- base, ou une sauvegarde, les lisait. Ils se chiffrent désormais dans
-- l'application, fichier et nom de fichier, chacun pour sa place (cf.
-- common/pieces-chiffrees.ts). La clé n'est pas en base : les pièces déjà
-- déposées se chiffrent juste après les migrations (db/chiffrer-pieces.ts).
--
-- `cle_version` : la version de chiffrement ; NULL, une pièce d'avant, en
-- clair le temps que le migrateur passe.
SET lock_timeout = '5s';

ALTER TABLE employee_documents ADD COLUMN cle_version smallint;
ALTER TABLE absence_documents ADD COLUMN cle_version smallint;
