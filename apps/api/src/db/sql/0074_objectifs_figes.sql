-- Ce qu'une fiche d'objectifs garde de son moment.
--
-- Un statut donné par l'agent restait attaché à l'identifiant du bloc : son
-- n+1 réécrivait l'objectif, le statut passait au nouveau texte, que l'agent
-- n'avait pas évalué. Chaque statut garde désormais l'empreinte du texte
-- auquel il répond ; le texte changé, le statut ne vaut plus.
--
-- Les formations d'une fiche se lisaient au présent, même sur une fiche
-- envoyée l'an passé : un certificat expiré depuis la faisait « à repasser ».
-- À l'envoi de l'auto-évaluation, leur état se fige avec la fiche.
SET lock_timeout = '5s';

ALTER TABLE objectifs_fiches
  ADD COLUMN statuts_empreintes jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(statuts_empreintes) = 'object'),
  ADD COLUMN formations_figees jsonb
    CHECK (formations_figees IS NULL OR jsonb_typeof(formations_figees) = 'array');
