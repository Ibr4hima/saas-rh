-- Les index qui manquaient à l'échelle (ADR-0067).
--
-- Mesurés sur une copie de la base portée à 3 000 agents, 905 000
-- notifications, 150 000 demandes d'absence et 2 millions de lignes d'audit :
-- chaque index ci-dessous remplace un parcours complet de table par une
-- lecture ciblée, avec le temps d'une requête avant et après.
--
-- Expand seul : des index, aucune donnée touchée. Créés dans la transaction
-- de la migration (pas CONCURRENTLY) : aux volumes d'aujourd'hui, quelques
-- secondes au plus.
SET lock_timeout = '5s';

-- Les appels et rappels d'une demande se retrouvent par le début de leur clé
-- (`conge:<id>:appel:`, `contract_deadline:<id>`). Sous la RLS, un LIKE ne
-- descend jamais dans un index : l'opérateur n'est pas « leakproof ». Le
-- code cherche donc par `^@` (starts_with, leakproof), que cet index sert.
-- 657 ms -> 2 ms par visa.
CREATE INDEX notifications_cle_prefixe_idx
  ON notifications (dedupe_key text_pattern_ops)
  WHERE dedupe_key IS NOT NULL;

-- Les appels en cours, que la relance relit chaque minute. 700 ms -> 0,2 ms.
CREATE INDEX notifications_appels_idx
  ON notifications (tenant_id, created_at)
  WHERE dedupe_key LIKE '%:appel:%';

-- Toutes les notifications d'une personne, rangées ou non : le compteur de
-- la cloche les lit à chaque relève. 205 ms -> 20 ms pour 5 000 avis.
CREATE INDEX notifications_destinataire_idx
  ON notifications (tenant_id, recipient_user_id);

-- Les retours anticipés qui attendent leur confirmation. 241 ms -> 0,02 ms.
CREATE INDEX absence_requests_reprises_idx
  ON absence_requests (tenant_id, created_at)
  WHERE status = 'approved' AND reprise_demandee IS NOT NULL;

-- Les demandes de la plus récente à la plus ancienne : l'historique des
-- files s'arrête aux cent premières au lieu de tout trier. 365 ms -> 0,7 ms.
CREATE INDEX absence_requests_recentes_idx
  ON absence_requests (tenant_id, created_at DESC);

-- Ce qu'un type d'absence a déjà servi (écran des types). 273 ms -> 23 ms.
CREATE INDEX absence_requests_type_idx
  ON absence_requests (tenant_id, absence_type_id);

-- L'historique d'un dossier : ses lignes d'audit, les plus récentes d'abord.
-- 1 s -> 0,2 ms.
CREATE INDEX audit_log_ligne_idx
  ON audit_log (row_id, occurred_at DESC);

-- La personne d'un compte, cherchée à chaque requête authentifiée.
CREATE INDEX persons_user_idx
  ON persons (user_id)
  WHERE user_id IS NOT NULL;
