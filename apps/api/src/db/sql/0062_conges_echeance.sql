-- Une demande de congé ne reste plus sans réponse. Après cinq jours ouvrés
-- sans visa du N+1, elle passe à la DCH (la demande le garde en mémoire) ;
-- déposée avant son premier jour et toujours en attente ce jour-là, elle
-- expire.
SET lock_timeout = '5s';

ALTER TABLE absence_requests DROP CONSTRAINT absence_requests_status_check;
ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired'));

ALTER TABLE absence_requests
  ADD COLUMN n1_sans_reponse boolean NOT NULL DEFAULT false;
