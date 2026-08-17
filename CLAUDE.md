# Teranga RH — guide pour les sessions Claude Code

SaaS de gestion RH et de paie pour l'Afrique de l'Ouest francophone (nom de code provisoire).
**Lire avant tout code** : `docs/architecture/README.md` (synthèse + 12 décisions) et `docs/adr/` (décisions gelées — ne jamais les contredire silencieusement ; une décision se remplace par une nouvelle ADR).

## Commandes

```bash
pnpm install              # installe tout le monorepo
pnpm db:up                # démarre Postgres 16 (docker compose)
pnpm db:migrate           # applique les migrations SQL (apps/api/src/db/sql)
pnpm dev                  # api (:3001) + web (:3000)
pnpm build                # build de tous les paquets (ordre géré par turbo)
pnpm typecheck            # tsc --noEmit partout
pnpm test                 # tests (le test RLS exige Postgres démarré + migré)
```

Copier `.env.example` vers `.env` à la racine (l'API le charge depuis la racine du repo).

## Structure

- `apps/api` — NestJS 11, Drizzle + pg. Modules par bounded context (`src/modules/*`).
- `apps/web` — Next.js (App Router), PWA à terme. Tailwind v4.
- `packages/contracts` — schémas Zod partagés (source des types côté client). Build tsc → dist.
- `packages/ui` — design tokens CSS (light/dark). Composants shadcn/ui à venir.
- `docs/architecture` — le dossier d'architecture (10 documents). `docs/adr` — les ADRs.

## Règles non négociables (résumé des ADRs)

1. **RLS partout** (ADR-0002) : toute table métier porte `tenant_id NOT NULL` + policy RLS `FORCE`. Le runtime se connecte en `app_user` (non-owner). Le contexte tenant est posé **uniquement** via `TenantDb.withTenant()` (SET LOCAL transactionnel) — jamais de `set_config` hors transaction, jamais de requête métier hors `withTenant`.
2. **Effective dating** (ADR-0003) : les attributs à effet temporel (affectations, salaires, barèmes) sont des tables de versions `daterange` + contrainte GiST. Jamais d'UPDATE destructif sur ces tables : on clôt une version, on en ouvre une autre.
3. **Audit append-only** (ADR-0008) : ne jamais accorder UPDATE/DELETE sur `audit_log`. Les triggers d'audit s'appliquent à toute nouvelle table métier (voir `0001_init.sql` pour le patron).
4. **Migrations expand/contract** (ADR-0010) : fichiers SQL numérotés dans `apps/api/src/db/sql/`, appliqués par le migrateur maison (`db:migrate`). Jamais de DDL destructif dans la release qui l'introduit. `lock_timeout` systématique en tête de migration.
5. **API REST /v1** (ADR-0006) : erreurs RFC 9457 (`application/problem+json`), pagination par curseur. Pas de webhooks/idempotence exposée avant un vrai intégrateur externe.
6. **UUID v7 côté application** (ADR-0010), `timestamptz` UTC, snake_case SQL, TypeScript strict, Zod aux frontières.
7. **Aucun code spécifique client** (`if tenant === APIX` interdit) — paramétrage générique ou refus.
8. **Interdits** tant que l'équipe est < 8 devs : microservices, Kafka, Kubernetes, GraphQL, CQRS généralisé (ADR-0001).

## Gates de qualité

Avant tout commit : `pnpm typecheck && pnpm build`. Le test d'étanchéité inter-tenant (`apps/api/tests/rls.spec.ts`) est LE gate de la Phase 0 : il doit passer contre un Postgres réel. Toute nouvelle table métier doit y être couverte ou justifier pourquoi non.

## Langue

Code et schéma en anglais ; UI, documentation et messages d'erreur utilisateur en français.
