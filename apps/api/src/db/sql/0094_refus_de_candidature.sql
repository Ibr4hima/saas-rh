-- Le courriel de refus d'une candidature.
--
-- Une candidature rejetée vaut au candidat un courriel qui le lui dit. Son
-- adresse ne s'écrit nulle part en clair (0079) : le courriel ne la recopie
-- pas. Il garde la candidature dont il parle (subject_id), et l'adresse se
-- lit, chiffrée, au moment d'envoyer. Parti, il ne garde plus rien du
-- candidat ; la candidature supprimée ou rouverte avant son départ, il ne
-- part pas.
SET lock_timeout = '5s';

ALTER TABLE outbound_emails ALTER COLUMN recipient DROP NOT NULL;

ALTER TABLE outbound_emails
  ADD CONSTRAINT outbound_emails_destinataire
  CHECK (recipient IS NOT NULL OR (kind = 'candidature_refusee' AND subject_id IS NOT NULL))
  NOT VALID;
ALTER TABLE outbound_emails VALIDATE CONSTRAINT outbound_emails_destinataire;
