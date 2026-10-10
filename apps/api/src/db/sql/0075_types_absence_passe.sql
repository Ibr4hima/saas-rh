-- Le paramétrage d'un type d'absence vaut pour l'année en cours et les
-- suivantes, pas pour le passé.
--
-- Le droit d'une année ne s'enregistre pas : il se recalcule à chaque
-- lecture depuis le type. Passer le congé annuel de 30 à 24 jours réécrivait
-- donc les soldes de toutes les années, quand l'écran promettait le
-- contraire. Modifié, un type laisse ici son paramétrage d'avant, qui reste
-- celui des années passées.
--
-- Et deux cadences s'affichaient sans jamais s'appliquer : « par mois »
-- (le solde restait à 0, chaque demande refusée) et « par événement » (le
-- nombre saisi ne plafonnait rien). Elles s'en vont : un type a un quota
-- annuel, ou n'en a pas. Ce que cela change aux types existants se garde
-- d'abord ici, pour leurs années passées.
SET lock_timeout = '5s';

CREATE TABLE absence_types_passe (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  absence_type_id  uuid NOT NULL REFERENCES absence_types (id) ON DELETE CASCADE,
  -- La dernière année que ce paramétrage régit ; les précédentes aussi,
  -- jusqu'à la ligne d'avant.
  jusqu_a_annee    integer NOT NULL CHECK (jusqu_a_annee BETWEEN 2000 AND 2100),
  deducts_balance  boolean NOT NULL,
  allowance_days   numeric(5, 2),
  frequency        text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT absence_types_passe_une_par_annee UNIQUE (absence_type_id, jusqu_a_annee)
);

ALTER TABLE absence_types_passe ENABLE ROW LEVEL SECURITY;
ALTER TABLE absence_types_passe FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON absence_types_passe
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
CREATE TRIGGER absence_types_passe_audit
  AFTER INSERT OR UPDATE OR DELETE ON absence_types_passe
  FOR EACH ROW EXECUTE FUNCTION audit_row();
-- Le passé s'écrit une fois et ne se réécrit pas.
GRANT SELECT, INSERT ON absence_types_passe TO app_user;

-- Les types que les cadences retirées vont changer gardent leur passé.
INSERT INTO absence_types_passe
  (tenant_id, absence_type_id, jusqu_a_annee, deducts_balance, allowance_days, frequency)
SELECT tenant_id, id, extract(year FROM CURRENT_DATE)::int - 1,
       deducts_balance, allowance_days, frequency
  FROM absence_types
 WHERE frequency = 'monthly'
    OR (frequency = 'none' AND (allowance_days IS NOT NULL OR deducts_balance))
ON CONFLICT DO NOTHING;

-- « N par mois » devient « 12 N par an » : le plus proche de ce qui était voulu.
UPDATE absence_types
   SET frequency = 'annual', allowance_days = LEAST(allowance_days * 12, 365)
 WHERE frequency = 'monthly';
-- Sans quota, un nombre ne plafonnait rien, et un décompte refusait tout.
UPDATE absence_types SET allowance_days = NULL WHERE frequency = 'none' AND allowance_days IS NOT NULL;
UPDATE absence_types SET deducts_balance = false WHERE frequency = 'none' AND deducts_balance;

ALTER TABLE absence_types DROP CONSTRAINT absence_types_frequency_check;
ALTER TABLE absence_types
  ADD CONSTRAINT absence_types_frequency_check CHECK (frequency IN ('annual', 'none'));
ALTER TABLE absence_types DROP CONSTRAINT absence_types_allowance_frequency_check;
-- Un quota annuel a son nombre de jours ; sans quota, pas de nombre.
ALTER TABLE absence_types
  ADD CONSTRAINT absence_types_allowance_frequency_check
  CHECK ((frequency = 'annual') = (allowance_days IS NOT NULL));
-- Seul un quota se décompte ; un type créé sans rien préciser n'a ni l'un ni l'autre.
ALTER TABLE absence_types ALTER COLUMN deducts_balance SET DEFAULT false;
ALTER TABLE absence_types
  ADD CONSTRAINT absence_types_decompte_annuel CHECK (NOT deducts_balance OR frequency = 'annual');
