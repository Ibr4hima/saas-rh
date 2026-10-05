-- Un congé validé peut encore changer. L'agent l'annule tant qu'il n'a pas
-- commencé, ou revient plus tôt (son N+1 confirme le retour) ; le N+1 ou
-- la DCH le rappellent. La demande en garde la trace : la fin prévue au
-- départ, qui a écourté ou annulé, quand et pourquoi.
SET lock_timeout = '5s';

ALTER TABLE absence_requests
  -- La fin validée au départ, quand le congé a été écourté (NULL sinon).
  ADD COLUMN fin_initiale date,
  -- Le jour de reprise que l'agent demande, en attente de confirmation.
  ADD COLUMN reprise_demandee date,
  -- Écourté : retour de l'agent, confirmé, ou rappel par l'employeur.
  ADD COLUMN ecourte_nature text CHECK (ecourte_nature IN ('retour', 'rappel')),
  ADD COLUMN ecourte_par_user_id uuid REFERENCES users (id),
  ADD COLUMN ecourte_le timestamptz,
  ADD COLUMN ecourte_motif text,
  -- Annulé par la DCH plutôt que par l'agent : qui, et pourquoi.
  ADD COLUMN annule_par_user_id uuid REFERENCES users (id),
  ADD COLUMN annule_motif text;
