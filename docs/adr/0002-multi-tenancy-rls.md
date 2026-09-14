# ADR-0002 — Multi-tenancy : schéma partagé + RLS Postgres forcée

**Statut** : acceptée · 2026-08-17

## Contexte

SaaS multi-clients dès la conception ; une fuite inter-tenant sur des données RH/paie est un événement mortel pour le produit. Alternatives considérées : schéma-par-tenant (coût migrations ×N, tooling), base-par-tenant (coût exploitation prohibitif à 100+ clients pour 1-2 devs).

## Décision

Toutes les tables métier portent `tenant_id uuid NOT NULL`. **Row-Level Security activée ET forcée** (`FORCE ROW LEVEL SECURITY`) sur chaque table tenantée, policy unique sur `current_setting('app.tenant_id')`. Unicité et index systématiquement préfixés `(tenant_id, …)`.

## Règles d'implémentation obligatoires (revue A15)

1. Le contexte tenant est posé par **`SET LOCAL` dans une transaction**, via un middleware/helper unique (`withTenant`) — jamais de `set_config` hors transaction (fuite avec le pooling).
2. L'application se connecte avec un **rôle non-owner** (`app_user`) — le owner bypasse la RLS.
3. Tout job asynchrone porte explicitement son `tenant_id` et rétablit le contexte.
4. Un **test d'étanchéité inter-tenant tourne en CI** contre Postgres réel, dans les conditions de pooling.

## Évolution

Gros clients extractibles vers une base dédiée par réplication logique filtrée sur `tenant_id` (offre souveraine single-tenant : packaging Docker, cf. ch. 06).
