-- Destructif : retire du journal d'audit les noms, adresses, téléphones et messages des candidats qu'il avait recopiés.
--
-- Jusqu'à 0079, chaque dépôt et chaque changement d'étape recopiait la
-- candidature entière dans le journal, où elle restait en clair. Les gestes
-- demeurent (quelle candidature, quelle étape, qui, quand) ; ce qui disait
-- la personne s'en va. Irréversible : faire la sauvegarde avant.
SET lock_timeout = '5s';

UPDATE audit_log
   SET old_data = old_data - ARRAY['given_name', 'family_name', 'email', 'phone', 'message'],
       new_data = new_data - ARRAY['given_name', 'family_name', 'email', 'phone', 'message']
 WHERE table_name = 'applications'
   AND (old_data ?| ARRAY['given_name', 'family_name', 'email', 'phone', 'message']
        OR new_data ?| ARRAY['given_name', 'family_name', 'email', 'phone', 'message']);
