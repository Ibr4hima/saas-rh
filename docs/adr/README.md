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
| [0014](0014-corrections-informations-personnelles.md) | Corrections des informations personnelles par l'employé                                 | acceptée, précisée par 0080                 |
| [0015](0015-courriels-sortants.md)                    | Courriels sortants : file dédiée, Mailpit en développement, Microsoft 365 en production | acceptée                                    |
| [0016](0016-compte-d-un-agent-parti.md)               | Compte d’un agent parti : mot de passe effacé après trente jours, retour par invitation | acceptée                                    |
| [0017](0017-invitations-au-portail.md)                | Invitations au portail : d’office au retour, groupées, suivies sur une page             | acceptée, page déléguable depuis 0025       |
| [0018](0018-contrat-a-venir.md)                       | Contrat à venir : hors contrat entre deux contrats, place appliquée le jour venu        | acceptée                                    |
| [0019](0019-retour-tete-d-unite-et-contrat-annule.md) | Retour à la tête de son unité, contrat à venir annulable                                | acceptée, retour d’office remplacé par 0020 |
| [0020](0020-reprise-des-responsabilites-au-choix.md)  | Au retour, la RH décide ce que l'agent reprend                                          | acceptée                                    |
| [0021](0021-passage-de-minuit.md)                     | Le passage de minuit                                                                    | acceptée, précisée par 0067                 |
| [0022](0022-mot-de-passe-oublie.md)                   | Mot de passe oublié : un lien par courriel, valable une heure, qui sert une fois        | acceptée                                    |
| [0023](0023-defense-en-profondeur.md)                 | Défense en profondeur : pièces chiffrées, origines, en-têtes                            | acceptée                                    |
| [0024](0024-inactivite-et-revue-des-droits.md)        | Déconnexion après trois jours d'inactivité, revue des droits d'accès                    | acceptée, règle des réponses levée par 0070 |
| [0025](0025-gestion-des-acces-deleguee.md)            | La gestion des accès se délègue                                                         | acceptée                                    |
| [0026](0026-fiche-objectifs-en-trois-parties.md)      | La fiche d'objectifs en trois parties : cases, formations à suivre, commentaires        | acceptée, en partie remplacée : 0027, 0055  |
| [0027](0027-formations-a-suivre-en-badges.md)         | Les formations à suivre en badges, atteintes au certificat                              | acceptée, précisée par 0057, 0058           |
| [0028](0028-notifications-reglees-par-sujet.md)       | Les notifications réglées par sujet : plateforme, courriel, WhatsApp                    | acceptée, WhatsApp retiré par 0074          |
| [0029](0029-refus-de-candidature-par-courriel.md)     | Le refus d'une candidature part par courriel, sans recopier l'adresse                   | acceptée, précisée par 0030 et 0062         |
| [0030](0030-candidatures-non-retenues-a-part.md)      | Les candidatures non retenues ont leur page                                             | acceptée                                    |
| [0031](0031-accuse-de-reception.md)                   | L'accusé de réception d'une candidature, et des courriels sans réponse                  | acceptée                                    |
| [0032](0032-absence-ponctuelle-a-l-heure.md)          | L'absence ponctuelle, à l'heure ou à la journée, plafonnée par demande                  | acceptée                                    |
| [0033](0033-fonction-de-responsable.md)               | La fonction de responsable s'écrit dans les affectations                                | acceptée, précisée par 0038 et 0064         |
| [0034](0034-n-plus-un-des-chefs-d-unite.md)           | Le chef d'un département ou d'un service relève de l'unité au-dessus                    | acceptée, relève précisée par 0035          |
| [0035](0035-releve-d-un-chef-et-stagiaires.md)        | Relève d'un chef : l'équipe passe au nouveau ; aucun stagiaire n'est n+1                | acceptée, directeurs précisés par 0037      |
| [0036](0036-responsable-choisi-dans-la-direction.md)  | Le responsable d'un département ou d'un service se choisit dans la direction            | acceptée                                    |
| [0037](0037-directeur-remplace-son-equipe-passe.md)   | Directeur remplacé : son équipe passe au nouveau directeur                              | acceptée                                    |
| [0038](0038-devenir-de-l-ancien-responsable.md)       | Responsable remplacé : il reste, change d'affectation, prend une autre tête ou part     | acceptée                                    |
| [0039](0039-bulletin-de-salaire-avec-ses-mois.md)     | Le bulletin de salaire se demande avec ses mois                                         | acceptée, précisée par 0044                 |
| [0040](0040-document-remis-en-ligne.md)               | Le document demandé peut se remettre en ligne                                           | acceptée, précisée par 0041, 0042           |
| [0041](0041-remise-en-ligne-en-pdf.md)                | Remise en ligne : un PDF, un nom choisi, un aperçu                                      | acceptée                                    |
| [0042](0042-demandes-effacees-et-consultees.md)       | Demandes de documents : ce qui s'efface, ce qui se consulte                             | acceptée, précisée par 0043                 |
| [0043](0043-suivi-en-cours-puis-traitees.md)          | Suivi des demandes de documents : en cours, puis traitées                               | acceptée, précisée par 0048 et 0081         |
| [0044](0044-demander-un-document-en-fenetre.md)       | Demander un document : un bloc, une fenêtre, sans précision                             | acceptée, précisée par 0045                 |
| [0045](0045-autre-document-retire.md)                 | « Autre document » ne se demande plus                                                   | acceptée                                    |
| [0046](0046-formateur-obligatoire.md)                 | Le formateur d'une formation est obligatoire                                            | acceptée, précisée par 0070                 |
| [0047](0047-sessions-et-signalement.md)               | Plus de « Se déconnecter partout » ; un signalement part sans précision                 | acceptée                                    |
| [0048](0048-nouvellement-traitees-en-evidence.md)     | Arrivé par l'avis, les demandes nouvellement traitées en évidence                       | acceptée, précisée par 0081                 |
| [0049](0049-evaluation-sans-minuterie.md)             | Academy : l'évaluation sans limite de temps, un certificat sans évaluation              | acceptée, minuterie rétablie par 0073       |
| [0050](0050-sans-evaluation-sans-echeance.md)         | Sans évaluation, un certificat sans limite de validité                                  | acceptée                                    |
| [0051](0051-fiche-objectifs-crayon.md)                | La fiche d'objectifs s'ouvre au crayon et s'enregistre d'un clic                        | acceptée, « Fixer » précisé par 0075        |
| [0052](0052-une-annee-a-la-fois.md)                   | Objectifs d'un direct : une année à la fois, la suivante fixée à l'avance               | acceptée, précisée par 0075 et 0078         |
| [0053](0053-dates-d-evaluation.md)                    | Deux dates d'évaluation par an, fixées par qui dirige la DCH                            | remplacée par ADR-0075                      |
| [0054](0054-jours-d-evaluation-chaque-annee.md)       | Dates d'évaluation : un jour et un mois, chaque année                                   | acceptée, une seule date depuis 0075        |
| [0055](0055-objectifs-a-echeance.md)                  | Objectifs à échéance, rangés dans l'évaluation où ils comptent                          | remplacée par ADR-0075                      |
| [0056](0056-fixer-des-objectifs-par-semestre.md)      | Fixer des objectifs par semestre, chacun avec son échéance                              | remplacée par ADR-0075                      |
| [0057](0057-echeance-confirmee-a-l-enregistrement.md) | L'échéance proche se confirme à l'enregistrement ; les formations n'en ont pas          | acceptée, en partie remplacée : 0075        |
| [0058](0058-formations-encadrees.md)                  | Formations encadrées par l'agent ; la fenêtre de confirmation comme la fiche            | en partie remplacée : 0059, 0070, 0075      |
| [0059](0059-report-au-s1.md)                          | Le champ du report dit « au S1 de 2027 »                                                | remplacée par ADR-0075                      |
| [0060](0060-files-de-la-dch.md)                       | Files de la DCH : sa demande sans geste, chacun ce qui lui est délégué                  | acceptée                                    |
| [0061](0061-offre-ouverte-apres-la-date-limite.md)    | Une offre reste ouverte après sa date limite ; seule la RH la ferme                     | acceptée                                    |
| [0062](0062-candidature-reconsideree-ou-effacee.md)   | Une candidature non retenue se reconsidère, ou s'efface définitivement                  | acceptée                                    |
| [0063](0063-suivi-des-contrats-sur-un-an.md)          | Suivi des contrats : la durée restante, sur un an                                       | acceptée, précisée par 0066                 |
| [0064](0064-secretariat-general.md)                   | Le Secrétariat général : son titre, et sa place sous le DG                              | acceptée                                    |
| [0065](0065-vider-les-notifications.md)               | Vider la boîte et les archives des notifications                                        | acceptée                                    |
| [0066](0066-suivi-des-contrats-titre-seul.md)         | Suivi des contrats : le titre seul en tête de la carte                                  | acceptée                                    |
| [0067](0067-performance-et-robustesse.md)             | Performance à l'échelle et robustesse : index, veille, délais                           | acceptée, précisée par 0068                 |
| [0068](0068-dernieres-routes-lentes.md)               | Les dernières routes lentes : personnel, circuit, candidatures                          | acceptée                                    |
| [0069](0069-envois-lourds-delai-par-route.md)         | Les envois lourds : un délai par route, la vidéo en flux jusqu'au bout                  | acceptée, précisée par 0072                 |
| [0070](0070-evaluation-ouverte-a-la-gestion.md)       | Academy : l'évaluation ouverte à qui gère le catalogue                                  | acceptée, précisée par 0071                 |
| [0071](0071-meme-regle-a-chaque-lecture.md)           | Academy : la même règle à chaque lecture, libre au certificat                           | acceptée                                    |
| [0072](0072-lecons-de-quinze-minutes.md)              | Academy : des leçons de quinze minutes au plus                                          | acceptée                                    |
| [0073](0073-evaluation-minutee.md)                    | Academy : l'évaluation minutée, sa durée réglée par la gestion                          | acceptée                                    |
| [0074](0074-notifications-sans-whatsapp.md)           | Notifications : la plateforme et le courriel, sans WhatsApp                             | acceptée                                    |
| [0075](0075-objectifs-annuels.md)                     | Objectifs : une fiche et une évaluation par an, la date au 15 décembre                  | acceptée, précisée par 0076                 |
| [0076](0076-evaluation-annuelle.md)                   | Évaluation annuelle : la coche de l'agent, l'atteinte de chaque objectif par le n+1     | acceptée, précisée par 0077 et 0079         |
| [0077](0077-resultats-obtenus.md)                     | Le dossier montre les résultats obtenus : la case de chaque objectif, rien d'autre      | acceptée                                    |
| [0078](0078-mes-objectifs-une-annee-a-la-fois.md)     | Mes objectifs : une année à la fois, comme chez le n+1                                  | acceptée                                    |
| [0079](0079-auto-evaluation-sans-commentaire.md)      | Auto-évaluation : un statut par objectif, sans commentaire                              | acceptée                                    |
| [0080](0080-certificat-de-mariage.md)                 | Le certificat de mariage accompagne le passage à « Marié(e) »                           | acceptée                                    |
| [0081](0081-suivi-des-mises-a-jour.md)                | Le suivi des demandes porte aussi les mises à jour d'informations                       | acceptée, précisée par 0082                 |
| [0082](0082-mise-a-jour-validee-hors-du-suivi.md)     | Validée, une mise à jour d'informations ne figure pas au suivi                          | acceptée                                    |
| [0083](0083-anciennete-du-contrat-en-cours.md)        | L'ancienneté est celle du contrat en cours ; le stage n'en donne pas                    | acceptée                                    |
