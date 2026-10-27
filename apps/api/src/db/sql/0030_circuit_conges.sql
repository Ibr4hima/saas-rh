-- Le circuit des congés n'est plus paramétrable : le n+1 de l'agent vise
-- d'abord, puis la RH (décision APIX). La liste de rôles réordonnable qui le
-- décrivait disparaît — garder une table que plus rien ne lit ferait croire
-- qu'elle compte encore.
--
-- Les demandes en attente gardent leur étape : 0, personne n'a encore visé,
-- c'est désormais au n+1 ; 1, un premier visa est posé, c'est à la RH.
DROP TABLE approval_chains;
