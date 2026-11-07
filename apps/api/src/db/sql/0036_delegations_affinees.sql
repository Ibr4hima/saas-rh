-- Quatre délégations de plus, plus fines.
--
-- Décision APIX : qui dirige la DCH confie à part les alertes d'échéance de
-- contrat, les jours fériés, les offres d'emploi et les dossiers de
-- candidature. Qui tenait l'habilitation plus large garde tout ce qu'il
-- faisait : rien ne change pour lui, et le directeur affine s'il le veut.

-- ——— Qui gérait les dossiers recevait les alertes d'échéance : il les reçoit toujours.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id, created_at)
SELECT gen_random_uuid(), tenant_id, 'contrats.echeances', employee_id,
       accordee_par_employee_id, created_at
  FROM habilitations
 WHERE capacite = 'personnel.gerer' AND fin_at IS NULL
ON CONFLICT DO NOTHING;

-- ——— Les paramètres des congés comprenaient les fériés.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id, created_at)
SELECT gen_random_uuid(), tenant_id, 'feries', employee_id, accordee_par_employee_id, created_at
  FROM habilitations
 WHERE capacite = 'conges.parametres' AND fin_at IS NULL
ON CONFLICT DO NOTHING;

-- ——— « Recrutement » devient les offres d'un côté, les candidatures de l'autre.
INSERT INTO habilitations (id, tenant_id, capacite, employee_id, accordee_par_employee_id, created_at)
SELECT gen_random_uuid(), tenant_id, 'recrutement.candidatures', employee_id,
       accordee_par_employee_id, created_at
  FROM habilitations
 WHERE capacite = 'recrutement' AND fin_at IS NULL
ON CONFLICT DO NOTHING;

UPDATE habilitations SET capacite = 'recrutement.offres'
 WHERE capacite = 'recrutement' AND fin_at IS NULL;
