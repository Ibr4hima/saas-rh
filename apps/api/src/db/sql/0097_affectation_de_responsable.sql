-- La fonction de responsable s'inscrit dans les affectations.
--
-- Désigné à la tête d'une unité, l'agent y prend le poste qui va avec
-- (« Directeur de la DGT », « Cheffe du service Comptabilité »), daté du jour
-- où il prend ses fonctions. Celui qu'il remplace reçoit son nouveau poste ce
-- même jour.
--
-- La colonne marque l'affectation qu'une désignation a écrite : tant que
-- l'agent dirige l'unité, elle ne s'annule pas, et celui qui la quitte
-- reçoit un autre poste. Les affectations d'avant la règle n'en portent pas.
SET lock_timeout = '5s';

ALTER TABLE assignments ADD COLUMN responsable boolean NOT NULL DEFAULT false;
