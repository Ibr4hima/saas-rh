-- Une offre dit quand elle a été publiée, et sa date limite la ferme.
--
-- Le statut disait « Publiée » à la RH quand le candidat lisait déjà « Cette
-- offre n'accepte plus de candidatures » : passé sa date limite, une offre
-- est close, pour tout le monde. Et la page publique datait l'offre de son
-- brouillon, pas du jour où elle a été rendue publique.
SET lock_timeout = '5s';

ALTER TABLE job_postings ADD COLUMN published_at timestamptz;
-- Les offres déjà publiées : la meilleure date connue est leur création.
UPDATE job_postings SET published_at = created_at WHERE status IN ('published', 'closed');

UPDATE job_postings SET status = 'closed', updated_at = now()
 WHERE status = 'published' AND deadline < CURRENT_DATE;
