-- Les échéances de contrat suivent la gestion du personnel.
--
-- Décision APIX : la page « Échéances de contrat » disparaît — le tableau de
-- bord suit les contrats — et ses alertes vont à qui gère les dossiers du
-- personnel, qui renouvelle ou clôt. La délégation à part n'a plus d'objet :
-- elle se clôt, et reste dans l'historique.
UPDATE habilitations SET fin_at = now(), fin_motif = 'retiree'
 WHERE capacite = 'contrats.echeances' AND fin_at IS NULL;

-- Les alertes déjà reçues mènent au dossier de l'agent, non plus à la page.
UPDATE notifications n SET link = '/employees/' || c.employee_id
  FROM contracts c
 WHERE n.link = '/contrats'
   AND n.dedupe_key IN ('contract_deadline:' || c.id, 'contrat_termine:' || c.id);

UPDATE notifications SET link = NULL WHERE link = '/contrats';
