# Architecture Decision Records

Les décisions structurantes du projet, gelées avant le premier commit de code (cf. [chapitre 08](../architecture/08-roadmap.md), §9). Une ADR n'est jamais modifiée après acceptation : elle est remplacée par une nouvelle qui la référence.

Format : contexte → décision → conséquences. Statuts : `acceptée` | `remplacée par ADR-XXXX`.

| #                                                     | Décision                                                                                | Statut                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| [0001](0001-monolithe-modulaire-typescript.md)        | Monolithe modulaire TypeScript (NestJS + Next.js, monorepo pnpm)                        | acceptée                                    |
| [0002](0002-multi-tenancy-rls.md)                     | Multi-tenancy : schéma partagé + RLS Postgres forcée                                    | acceptée                                    |
| [0003](0003-effective-dating.md)                      | Effective dating par tables versionnées (daterange + GiST)                              | acceptée                                    |
| [0004](0004-pilote-apix-deux-lots.md)                 | Pilote APIX en deux lots contractualisés                                                | acceptée                                    |
| [0005](0005-pwa-cible-mobile-unique.md)               | PWA Next.js unique cible mobile jusqu'à la V1+                                          | acceptée                                    |
| [0006](0006-api-rest-conventions.md)                  | API REST /v1 — conventions MVP, plomberie publique différée                             | acceptée                                    |
| [0007](0007-moteur-paie-pur-packs-pays.md)            | Moteur de paie = fonction pure + packs pays immuables                                   | acceptée                                    |
| [0008](0008-audit-append-only.md)                     | Audit log append-only, immutabilité des données de paie                                 | acceptée                                    |
| [0009](0009-auth-maison.md)                           | Auth maison : Argon2id, sessions opaques, MFA TOTP pour rôles sensibles                 | acceptée                                    |
| [0010](0010-conventions-schema.md)                    | Conventions de schéma : UUIDv7 applicatif, timestamptz UTC, snake_case                  | acceptée                                    |
| [0011](0011-signature-electronique-deux-etages.md)    | Signature électronique à deux étages (avancée maison V1, qualifiée V2)                  | acceptée                                    |
| [0012](0012-arbitrages-direction-capital-humain.md)   | Arbitrages de la Direction du Capital Humain (APIX)                                     | acceptée                                    |
| [0013](0013-coherence-organigramme.md)                | Règles de cohérence de l'organigramme                                                   | acceptée                                    |
| [0014](0014-corrections-informations-personnelles.md) | Corrections des informations personnelles par l'employé                                 | acceptée                                    |
| [0015](0015-courriels-sortants.md)                    | Courriels sortants : file dédiée, Mailpit en développement, Microsoft 365 en production | acceptée                                    |
| [0016](0016-compte-d-un-agent-parti.md)               | Compte d’un agent parti : mot de passe effacé après trente jours, retour par invitation | acceptée                                    |
| [0017](0017-invitations-au-portail.md)                | Invitations au portail : d’office au retour, groupées, suivies sur une page             | acceptée                                    |
| [0018](0018-contrat-a-venir.md)                       | Contrat à venir : hors contrat entre deux contrats, place appliquée le jour venu        | acceptée                                    |
| [0019](0019-retour-tete-d-unite-et-contrat-annule.md) | Retour à la tête de son unité, contrat à venir annulable                                | acceptée, retour d’office remplacé par 0020 |
| [0020](0020-reprise-des-responsabilites-au-choix.md)  | Au retour, la RH décide ce que l'agent reprend                                          | acceptée                                    |
| [0021](0021-passage-de-minuit.md)                     | Le passage de minuit                                                                    | acceptée                                    |
