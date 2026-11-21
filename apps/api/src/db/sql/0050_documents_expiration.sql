-- Les titres d'identité ont une date d'expiration.
--
-- Décision APIX : l'agent qui dépose sa carte nationale d'identité ou son
-- passeport en donne la date d'expiration. Elle lui sert, à lui : il est
-- prévenu quinze jours avant, puis le jour même, pour le renouveler.
SET lock_timeout = '5s';

ALTER TABLE employee_documents ADD COLUMN expires_on date;

ALTER TABLE employee_documents
  ADD CONSTRAINT employee_documents_expiration_check
  CHECK (expires_on IS NULL OR category IN ('cni', 'passeport'));
