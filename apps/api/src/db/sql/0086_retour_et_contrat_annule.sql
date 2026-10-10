-- Ce qu'un départ laisse, et ce qu'un contrat à venir remplace.
--
-- Un agent dont le contrat prend fin laisse les unités qu'il dirigeait sans
-- responsable, et son équipe passe à d'autres. S'il revient et qu'aucun
-- successeur n'a été nommé, il les retrouve : son départ garde la liste de
-- ces unités, et où chacun de son équipe est allé.
--
-- Un contrat qui n'a pas commencé s'annule. Le contrat en cours, qu'il
-- arrêtait la veille de son début, retrouve alors sa fin d'origine : le
-- nouveau contrat la garde.
SET lock_timeout = '5s';

ALTER TABLE periodes_inactivite
  ADD COLUMN headed_unit_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN team_reassignments jsonb NOT NULL DEFAULT '[]';

ALTER TABLE contracts
  ADD COLUMN previous_end_replaced boolean NOT NULL DEFAULT false,
  ADD COLUMN previous_end_date date;
