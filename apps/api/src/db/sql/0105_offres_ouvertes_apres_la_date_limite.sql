-- Une offre reste ouverte après sa date limite (ADR-0061) : la date s'annonce
-- au candidat, elle ne ferme plus rien. Seule la RH ferme une offre, en
-- l'archivant, à tout moment.
--
-- Les offres que le système avait closes pour leur date limite (0067, puis à
-- chaque lecture de la liste) se rouvrent : leur dernière clôture, au journal,
-- n'a pas d'auteur. Une offre archivée par la RH garde son statut.
SET lock_timeout = '5s';

UPDATE job_postings j SET status = 'published', updated_at = now()
 WHERE j.status = 'closed'
   AND (SELECT a.actor_user_id IS NULL
          FROM audit_log a
         WHERE a.table_name = 'job_postings' AND a.row_id = j.id AND a.action = 'UPDATE'
           AND a.new_data ->> 'status' = 'closed'
           AND a.old_data ->> 'status' IS DISTINCT FROM 'closed'
         ORDER BY a.occurred_at DESC, a.id DESC
         LIMIT 1);
