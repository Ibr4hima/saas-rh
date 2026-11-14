-- Les contrats ne se demandent plus : la DCH les établit d'elle-même, selon
-- la situation de la personne (ADR-0114). Leurs délégations de traitement se
-- closent et restent dans l'historique ; une demande ancienne encore ouverte
-- revient à qui dirige la DCH, qui la traite toujours. La génération des
-- contrats se délègue à part, contrat par contrat, depuis « Déléguer des
-- tâches ».
UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree'
 WHERE capacite IN ('demandes.documents.contrat_cdd',
                    'demandes.documents.contrat_cdi',
                    'demandes.documents.contrat_stage')
   AND fin_at IS NULL;
