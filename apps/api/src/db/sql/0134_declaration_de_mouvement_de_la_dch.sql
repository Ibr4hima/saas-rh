-- La déclaration de mouvement du travailleur ne se demande plus : la DCH la
-- produit au besoin, un agent ne la demande pas (ADR-0198). Ses délégations
-- de traitement se closent et restent dans l'historique ; une demande
-- ancienne encore ouverte revient à qui dirige la DCH, qui la traite
-- toujours. Sa génération se délègue à part, depuis « Déléguer des tâches »,
-- comme celle des contrats (0116).
UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree'
 WHERE capacite = 'demandes.documents.declaration_mouvement'
   AND fin_at IS NULL;
