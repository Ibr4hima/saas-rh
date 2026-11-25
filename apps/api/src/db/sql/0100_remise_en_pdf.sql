-- La remise en ligne, en PDF seulement (ADR-0041) : le document signé et
-- cacheté se numérise en PDF, et l'agent reçoit toujours le même format.
--
-- La contrainte des types devient plus stricte. NOT VALID : un fichier déjà
-- déposé en image reste lisible ; seuls les nouveaux dépôts sont des PDF.
--
-- Le nom d'un document remis se corrige après dépôt : c'est celui que l'agent
-- voit et enregistre. Seul le nom se modifie, jamais le contenu.
SET lock_timeout = '5s';

ALTER TABLE document_request_files DROP CONSTRAINT document_request_files_type;
ALTER TABLE document_request_files
  ADD CONSTRAINT document_request_files_type
  CHECK (content_type = 'application/pdf')
  NOT VALID;

GRANT UPDATE (filename) ON document_request_files TO app_user;
