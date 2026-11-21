-- Ce qu'un agent reprend à son retour : la RH le décide.
--
-- Revenu, il ne redevient plus d'office responsable des unités qu'il
-- dirigeait : la DCH choisit, au nouveau contrat ou à la réactivation. Un
-- contrat qui commence plus tard garde ce choix jusqu'à son premier jour.
SET lock_timeout = '5s';

ALTER TABLE contracts
  ADD COLUMN resume_unit_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN resume_team boolean NOT NULL DEFAULT false;
