-- L'agent retire une demande de document ou de mise à jour d'infos tant
-- qu'elle n'est pas traitée : elle passe « annulée », et sort de la file.
SET lock_timeout = '5s';

ALTER TABLE document_requests DROP CONSTRAINT document_requests_status_check;
ALTER TABLE document_requests ADD CONSTRAINT document_requests_status_check
  CHECK (status IN ('received', 'processing', 'ready', 'delivered', 'rejected', 'cancelled'));

ALTER TABLE profile_change_requests DROP CONSTRAINT profile_change_requests_status_check;
ALTER TABLE profile_change_requests ADD CONSTRAINT profile_change_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));
