-- =============================================================================
-- 0020 — Un jour férié qui n'a pas encore de date, et aucun qui soit indéboulonnable
--
-- Deux manques que l'usage a fait sortir.
--
-- 1. La Korité se sait quelques jours avant, pas en janvier. On voulait donc
--    pouvoir inscrire la fête MAINTENANT et la dater plus tard — ce que
--    `day NOT NULL` interdisait. Un férié sans date est un vrai état du
--    domaine, pas un trou : c'est la situation normale de huit fêtes sur
--    quatorze pendant la majeure partie de l'année.
--
--    Une fête sans date n'appartient pourtant à aucune année si on ne le dit
--    pas : le tableau se lit année par année. D'où `year`, qui devient le seul
--    rattachement sûr — la date, elle, peut manquer.
--
-- 2. Rien n'est acquis pour toujours. Si l'Assomption cessait d'être chômée au
--    Sénégal, il faudrait pouvoir la retirer — le refus de suppression des
--    dates civiles disparaît donc (côté service). Ce qui oblige à savoir si
--    une année a DÉJÀ reçu son socle : sans mémoire, la ligne supprimée
--    reviendrait au prochain affichage. C'est tout l'objet de `holiday_seeds`.
-- =============================================================================

SET lock_timeout = '5s';

-- ── L'année, puis la date facultative ────────────────────────────────────────

ALTER TABLE holidays ADD COLUMN year integer;
UPDATE holidays SET year = extract(year FROM day)::int;
ALTER TABLE holidays ALTER COLUMN year SET NOT NULL;

ALTER TABLE holidays ALTER COLUMN day DROP NOT NULL;

-- Deux fériés le même jour restent absurdes, mais l'unicité ne peut plus être
-- portée par une contrainte de table : plusieurs jours sans date coexistent, et
-- NULL n'entre pas dans un UNIQUE ordinaire de manière lisible. Index partiel.
ALTER TABLE holidays DROP CONSTRAINT holidays_tenant_id_day_key;
CREATE UNIQUE INDEX holidays_tenant_day_uq
  ON holidays (tenant_id, day) WHERE day IS NOT NULL;

-- Une date de 2026 ne se range pas dans l'année 2025 : le tableau est lu par
-- année, et une ligne mal rangée y serait invisible.
ALTER TABLE holidays ADD CONSTRAINT holidays_day_in_year_check
  CHECK (day IS NULL OR extract(year FROM day)::int = year);

CREATE INDEX holidays_tenant_year_idx ON holidays (tenant_id, year);

-- ── La mémoire du socle ──────────────────────────────────────────────────────
--
-- Les quatorze fériés sénégalais sont posés la première fois qu'une année est
-- consultée. « La première fois » ne se déduit pas du contenu de la table :
-- une année vide peut être une année jamais ouverte OU une année dont on a
-- retiré tous les jours. Confondre les deux ferait revenir ce qu'on vient de
-- supprimer — exactement ce que la suppression est censée empêcher.
CREATE TABLE holiday_seeds (
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  year      integer NOT NULL,
  seeded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, year)
);

ALTER TABLE holiday_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE holiday_seeds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON holiday_seeds
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

-- Pas de déclencheur d'audit : la table ne porte rien de la personne, et le
-- journal n'a rien à dire de « l'année 2026 a été ouverte ».
GRANT SELECT, INSERT ON holiday_seeds TO app_user;

-- Les années déjà peuplées ont, de fait, reçu leur socle : sans cette reprise,
-- le premier affichage après migration réinsérerait les quatorze.
INSERT INTO holiday_seeds (tenant_id, year)
SELECT DISTINCT tenant_id, year FROM holidays
ON CONFLICT DO NOTHING;
