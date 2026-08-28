# ADR-0010 — Conventions de schéma et de code

**Statut** : acceptée · 2026-08-17

## Décision

- **UUID v7 générés côté application** (indépendance de la version Postgres — revue A14) ; clés primaires `uuid`.
- **`timestamptz` UTC exclusivement** ; les dates « métier » (effet RH) sont des `date` locales assumées.
- **snake_case anglais** pour tables/colonnes ; français pour l'UI et la doc.
- `tenant_id` NOT NULL sur toute table métier ; unicité et index préfixés `(tenant_id, …)`.
- Soft delete (`deleted_at`) uniquement où le métier l'exige ; jamais sur paie/audit.
- Migrations SQL **expand/contract** (jamais de DDL destructif dans la release qui l'introduit), `lock_timeout` systématique.
- TypeScript `strict` partout ; pas de `any` non justifié ; Zod aux frontières (API, imports, jobs).
