-- L'envoi de la fiche au N+2 (ADR-0278) : au choix du N+1, la fiche part
-- au N+2 en même temps qu'à l'agent, au moment de transmettre
-- l'évaluation ; plus tard, ce n'est plus possible. envoyee_n2_le garde ce
-- moment. Une fiche déjà transmise à l'agent suit la règle d'avant, qui
-- l'envoyait au N+2 s'il y en avait un : elle est envoyée depuis sa
-- transmission.
SET lock_timeout = '5s';

ALTER TABLE fiches_entretien ADD COLUMN envoyee_n2_le timestamptz;

UPDATE fiches_entretien
   SET envoyee_n2_le = evaluation_transmise_le
 WHERE evaluation_transmise_le IS NOT NULL;
