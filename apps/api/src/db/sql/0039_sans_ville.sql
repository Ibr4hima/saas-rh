-- La ville quitte le dossier de l'agent.
--
-- Décision APIX : la création d'un employé ne la demande pas ; rien ne doit
-- donc la faire exister ailleurs — ni la fiche, ni la modification, ni les
-- demandes de changement d'informations. L'adresse suffit.

-- Les demandes qui ne portaient QUE sur la ville n'ont plus d'objet : elles
-- partent, avec les appels qui attendaient encore quelqu'un pour les traiter.
DELETE FROM notifications n
 USING profile_change_requests r
 WHERE r.changes ? 'city' AND r.changes - 'city' = '{}'::jsonb
   AND (n.dedupe_key LIKE 'information:' || r.id || ':appel:%'
        OR n.dedupe_key LIKE 'information:' || r.id || ':rappel:%');

DELETE FROM profile_change_requests
 WHERE changes ? 'city' AND changes - 'city' = '{}'::jsonb;

-- Les autres gardent le reste de ce qu'elles demandaient.
UPDATE profile_change_requests
   SET changes = changes - 'city', previous = previous - 'city'
 WHERE changes ? 'city' OR previous ? 'city';

ALTER TABLE persons DROP COLUMN city;
