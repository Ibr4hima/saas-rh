-- L'accusé de réception d'une candidature.
--
-- Le candidat qui dépose son dossier reçoit un courriel qui le lui confirme.
-- Comme le refus (0094), il ne recopie pas l'adresse : elle se lit, chiffrée,
-- dans la candidature au moment d'envoyer.
SET lock_timeout = '5s';

ALTER TABLE outbound_emails DROP CONSTRAINT outbound_emails_destinataire;
ALTER TABLE outbound_emails
  ADD CONSTRAINT outbound_emails_destinataire
  CHECK (recipient IS NOT NULL
         OR (kind IN ('candidature_recue', 'candidature_refusee') AND subject_id IS NOT NULL))
  NOT VALID;
ALTER TABLE outbound_emails VALIDATE CONSTRAINT outbound_emails_destinataire;
