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
| [0012](0012-arbitrages-direction-capital-humain.md)   | Arbitrages de la Direction du Capital Humain (APIX)                                     | acceptée, précisée par 0040, 0042           |
| [0013](0013-coherence-organigramme.md)                | Règles de cohérence de l'organigramme                                                   | acceptée, précisée par 0034 et 0036         |
| [0014](0014-corrections-informations-personnelles.md) | Corrections des informations personnelles par l'employé                                 | acceptée                                    |
| [0015](0015-courriels-sortants.md)                    | Courriels sortants : file dédiée, Mailpit en développement, Microsoft 365 en production | acceptée                                    |
| [0016](0016-compte-d-un-agent-parti.md)               | Compte d’un agent parti : mot de passe effacé après trente jours, retour par invitation | acceptée                                    |
| [0017](0017-invitations-au-portail.md)                | Invitations au portail : d’office au retour, groupées, suivies sur une page             | acceptée, page déléguable depuis 0025       |
| [0018](0018-contrat-a-venir.md)                       | Contrat à venir : hors contrat entre deux contrats, place appliquée le jour venu        | acceptée                                    |
| [0019](0019-retour-tete-d-unite-et-contrat-annule.md) | Retour à la tête de son unité, contrat à venir annulable                                | acceptée, retour d’office remplacé par 0020 |
| [0020](0020-reprise-des-responsabilites-au-choix.md)  | Au retour, la RH décide ce que l'agent reprend                                          | acceptée                                    |
| [0021](0021-passage-de-minuit.md)                     | Le passage de minuit                                                                    | acceptée                                    |
| [0022](0022-mot-de-passe-oublie.md)                   | Mot de passe oublié : un lien par courriel, valable une heure, qui sert une fois        | acceptée                                    |
| [0023](0023-defense-en-profondeur.md)                 | Défense en profondeur : pièces chiffrées, origines, en-têtes                            | acceptée                                    |
| [0024](0024-inactivite-et-revue-des-droits.md)        | Déconnexion après trois jours d'inactivité, revue des droits d'accès                    | acceptée                                    |
| [0025](0025-gestion-des-acces-deleguee.md)            | La gestion des accès se délègue                                                         | acceptée                                    |
| [0026](0026-fiche-objectifs-en-trois-parties.md)      | La fiche d'objectifs en trois parties : cases, formations à suivre, commentaires        | acceptée, formations remplacées par 0027    |
| [0027](0027-formations-a-suivre-en-badges.md)         | Les formations à suivre en badges, atteintes au certificat                              | acceptée                                    |
| [0028](0028-notifications-reglees-par-sujet.md)       | Les notifications réglées par sujet : plateforme, courriel, WhatsApp                    | acceptée                                    |
| [0029](0029-refus-de-candidature-par-courriel.md)     | Le refus d'une candidature part par courriel, sans recopier l'adresse                   | acceptée, non retenues à part par 0030      |
| [0030](0030-candidatures-non-retenues-a-part.md)      | Les candidatures non retenues ont leur page                                             | acceptée                                    |
| [0031](0031-accuse-de-reception.md)                   | L'accusé de réception d'une candidature, et des courriels sans réponse                  | acceptée                                    |
| [0032](0032-absence-ponctuelle-a-l-heure.md)          | L'absence ponctuelle, à l'heure ou à la journée, plafonnée par demande                  | acceptée                                    |
| [0033](0033-fonction-de-responsable.md)               | La fonction de responsable s'écrit dans les affectations                                | acceptée, précisée par 0038                 |
| [0034](0034-n-plus-un-des-chefs-d-unite.md)           | Le chef d'un département ou d'un service relève de l'unité au-dessus                    | acceptée, relève précisée par 0035          |
| [0035](0035-releve-d-un-chef-et-stagiaires.md)        | Relève d'un chef : l'équipe passe au nouveau ; aucun stagiaire n'est n+1                | acceptée, directeurs précisés par 0037      |
| [0036](0036-responsable-choisi-dans-la-direction.md)  | Le responsable d'un département ou d'un service se choisit dans la direction            | acceptée                                    |
| [0037](0037-directeur-remplace-son-equipe-passe.md)   | Directeur remplacé : son équipe passe au nouveau directeur                              | acceptée                                    |
| [0038](0038-devenir-de-l-ancien-responsable.md)       | Responsable remplacé : il reste, change d'affectation, prend une autre tête ou part     | acceptée                                    |
| [0039](0039-bulletin-de-salaire-avec-ses-mois.md)     | Le bulletin de salaire se demande avec ses mois                                         | acceptée, précisée par 0044                 |
| [0040](0040-document-remis-en-ligne.md)               | Le document demandé peut se remettre en ligne                                           | acceptée, précisée par 0041, 0042           |
| [0041](0041-remise-en-ligne-en-pdf.md)                | Remise en ligne : un PDF, un nom choisi, un aperçu                                      | acceptée                                    |
| [0042](0042-demandes-effacees-et-consultees.md)       | Demandes de documents : ce qui s'efface, ce qui se consulte                             | acceptée, précisée par 0043                 |
| [0043](0043-suivi-en-cours-puis-traitees.md)          | Suivi des demandes de documents : en cours, puis traitées                               | acceptée, précisée par 0048                 |
| [0044](0044-demander-un-document-en-fenetre.md)       | Demander un document : un bloc, une fenêtre, sans précision                             | acceptée, précisée par 0045                 |
| [0045](0045-autre-document-retire.md)                 | « Autre document » ne se demande plus                                                   | acceptée                                    |
| [0046](0046-formateur-obligatoire.md)                 | Le formateur d'une formation est obligatoire                                            | acceptée                                    |
| [0047](0047-sessions-et-signalement.md)               | Plus de « Se déconnecter partout » ; un signalement part sans précision                 | acceptée                                    |
| [0048](0048-nouvellement-traitees-en-evidence.md)     | Arrivé par l'avis, les demandes nouvellement traitées en évidence                       | acceptée                                    |
| [0049](0049-evaluation-sans-minuterie.md)             | Academy : l'évaluation sans limite de temps, un certificat sans évaluation              | acceptée, précisée par 0050                 |
| [0050](0050-sans-evaluation-sans-echeance.md)         | Sans évaluation, un certificat sans limite de validité                                  | acceptée                                    |
| [0051](0051-fiche-objectifs-crayon.md)                | La fiche d'objectifs s'ouvre au crayon et s'enregistre d'un clic                        | acceptée                                    |
| [0052](0052-une-annee-a-la-fois.md)                   | Objectifs d'un direct : une année à la fois, la suivante fixée à l'avance               | acceptée                                    |
