-- Le bulletin de salaire se demande pour une période : un mois, les N
-- derniers mois, ou de tel mois à tel mois. Elle s'écrit à part de la
-- précision libre : la DCH sait quels bulletins sortir.
--
-- Un mois ou une période : le premier et le dernier mois, chacun au 1er du
-- mois, l'un et l'autre compris (le même pour un seul mois), douze au plus.
-- Les N derniers : leur nombre ; la date de la demande dit lesquels.
SET lock_timeout = '5s';

ALTER TABLE document_requests
  ADD COLUMN payslip_from date,
  ADD COLUMN payslip_to date,
  ADD COLUMN payslip_last_months smallint,
  ADD CONSTRAINT document_requests_payslip_period CHECK (
    (payslip_from IS NULL AND payslip_to IS NULL AND payslip_last_months IS NULL)
    OR (payslip_last_months IS NULL
        AND payslip_from IS NOT NULL AND payslip_to IS NOT NULL
        AND date_trunc('month', payslip_from) = payslip_from
        AND date_trunc('month', payslip_to) = payslip_to
        AND payslip_to >= payslip_from
        AND payslip_to < payslip_from + interval '12 months')
    OR (payslip_from IS NULL AND payslip_to IS NULL
        AND payslip_last_months BETWEEN 2 AND 12)
  ),
  -- Des mois ne se précisent que pour un bulletin de salaire.
  ADD CONSTRAINT document_requests_payslip_only CHECK (
    (payslip_from IS NULL AND payslip_last_months IS NULL)
    OR doc_types = ARRAY['bulletin_salaire']
  );
