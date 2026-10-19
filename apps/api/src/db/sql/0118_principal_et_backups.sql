-- Principal et backups (ADR-0128). Une délégation de demandes confiée à
-- plusieurs personnes a sa personne principale, qui traite seule pendant
-- 48 heures ouvrées ; les backups reçoivent ensuite la demande, ou plus tôt
-- si la personne principale la leur confie.
SET lock_timeout = '5s';

ALTER TABLE habilitations ADD COLUMN principal boolean NOT NULL DEFAULT false;
-- Une personne principale par délégation en cours.
CREATE UNIQUE INDEX habilitations_un_principal
  ON habilitations (tenant_id, capacite) WHERE fin_at IS NULL AND principal;

-- Les délégations de demandes en place : la personne déléguée la première
-- devient principale, comme le fera l'application.
UPDATE habilitations h SET principal = true
 WHERE h.fin_at IS NULL AND h.capacite LIKE 'demandes.%'
   AND NOT EXISTS (
     SELECT 1 FROM habilitations a
      WHERE a.tenant_id = h.tenant_id AND a.capacite = h.capacite AND a.fin_at IS NULL
        AND (a.created_at, a.employee_id) < (h.created_at, h.employee_id));

-- La demande confiée aux backups avant la fin de la fenêtre de 48 heures.
ALTER TABLE absence_requests ADD COLUMN ouverte_aux_backups_le timestamptz;
ALTER TABLE document_requests ADD COLUMN ouverte_aux_backups_le timestamptz;
ALTER TABLE profile_change_requests ADD COLUMN ouverte_aux_backups_le timestamptz;
ALTER TABLE employee_documents ADD COLUMN ouverte_aux_backups_le timestamptz;

-- Un congé arrive à la DCH après le visa du N+1 : la fenêtre de 48 heures
-- court depuis. Les demandes qui y attendent déjà : depuis le visa, à défaut
-- depuis le dépôt.
ALTER TABLE absence_requests ADD COLUMN a_la_dch_le timestamptz;
UPDATE absence_requests r
   SET a_la_dch_le = COALESCE(
     (SELECT max(a.decided_at) FROM absence_approvals a
       WHERE a.request_id = r.id AND a.level = 0),
     r.created_at)
 WHERE r.status = 'pending' AND r.current_level >= 1;
