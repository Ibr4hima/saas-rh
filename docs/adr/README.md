# Architecture Decision Records

Les décisions structurantes du projet, gelées avant le premier commit de code (cf. [chapitre 08](../architecture/08-roadmap.md), §9). Une ADR n'est jamais modifiée après acceptation : elle est remplacée par une nouvelle qui la référence.

Format : contexte → décision → conséquences. Statuts : `acceptée` | `remplacée par ADR-XXXX`.

| #                                                  | Décision                                                                | Statut   |
| -------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| [0001](0001-monolithe-modulaire-typescript.md)     | Monolithe modulaire TypeScript (NestJS + Next.js, monorepo pnpm)        | acceptée |
| [0002](0002-multi-tenancy-rls.md)                  | Multi-tenancy : schéma partagé + RLS Postgres forcée                    | acceptée |
| [0003](0003-effective-dating.md)                   | Effective dating par tables versionnées (daterange + GiST)              | acceptée |
| [0004](0004-pilote-apix-deux-lots.md)              | Pilote APIX en deux lots contractualisés                                | acceptée |
| [0005](0005-pwa-cible-mobile-unique.md)            | PWA Next.js unique cible mobile jusqu'à la V1+                          | acceptée |
| [0006](0006-api-rest-conventions.md)               | API REST /v1 — conventions MVP, plomberie publique différée             | acceptée |
| [0007](0007-moteur-paie-pur-packs-pays.md)         | Moteur de paie = fonction pure + packs pays immuables                   | acceptée |
| [0008](0008-audit-append-only.md)                  | Audit log append-only, immutabilité des données de paie                 | acceptée |
| [0009](0009-auth-maison.md)                        | Auth maison : Argon2id, sessions opaques, MFA TOTP pour rôles sensibles | acceptée |
| [0010](0010-conventions-schema.md)                 | Conventions de schéma : UUIDv7 applicatif, timestamptz UTC, snake_case  | acceptée |
| [0011](0011-signature-electronique-deux-etages.md) | Signature électronique à deux étages (avancée maison V1, qualifiée V2)  | acceptée |
