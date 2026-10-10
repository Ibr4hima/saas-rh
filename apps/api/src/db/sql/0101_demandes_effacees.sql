-- Destructif : efface les demandes de documents annulées, et les demandes closes qu'une demande identique plus récente remplace (ADR-0042).
--
-- Une demande annulée s'efface désormais ; une demande identique à une
-- ancienne remplace celle-ci. Les demandes d'avant suivent la même règle :
--  - annulées : elles s'en vont ;
--  - closes (prêtes, remises, refusées) : s'il existe une demande plus récente
--    du même agent, pour le même document et les mêmes mois de bulletin
--    (« les N derniers mois » : demandée le même mois), l'ancienne s'en va.
-- Une demande en cours ne s'efface jamais. Les documents remis en ligne et
-- les avis de chaque demande effacée partent avec elle. Irréversible : faire
-- la sauvegarde avant.
SET lock_timeout = '5s';

CREATE TEMP TABLE demandes_effacees ON COMMIT DROP AS
SELECT a.id
  FROM document_requests a
 WHERE a.status = 'cancelled'
    OR (a.status NOT IN ('received', 'processing')
        AND EXISTS (
          SELECT 1
            FROM document_requests n
           WHERE n.tenant_id = a.tenant_id
             AND n.employee_id = a.employee_id
             AND n.id <> a.id
             AND n.status <> 'cancelled'
             AND (n.created_at, n.id) > (a.created_at, a.id)
             AND (SELECT array_agg(x ORDER BY x) FROM unnest(n.doc_types) x)
               = (SELECT array_agg(x ORDER BY x) FROM unnest(a.doc_types) x)
             AND n.payslip_from IS NOT DISTINCT FROM a.payslip_from
             AND n.payslip_to IS NOT DISTINCT FROM a.payslip_to
             AND n.payslip_last_months IS NOT DISTINCT FROM a.payslip_last_months
             AND (a.payslip_last_months IS NULL
                  OR date_trunc('month', n.created_at) = date_trunc('month', a.created_at))));

DELETE FROM notifications n
 USING demandes_effacees e
 WHERE n.dedupe_key LIKE 'document:' || e.id || ':%';

DELETE FROM document_request_files f
 USING demandes_effacees e
 WHERE f.request_id = e.id;

DELETE FROM document_requests r
 USING demandes_effacees e
 WHERE r.id = e.id;
