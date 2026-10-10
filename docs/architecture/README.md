# Teranga RH — Dossier d'architecture

> **Statut** : v0.1 — dossier de conception initial, produit avant toute ligne de code.
> **Nom de code** : « Teranga RH » (placeholder, à valider).
> **Méthode** : 8 chapitres rédigés en parallèle par des angles d'analyse indépendants, puis passés au crible de deux revues adverses (un CTO sceptique, un consultant SIRH terrain). Les contradictions relevées ont été arbitrées — voir [09-revue-critique.md](09-revue-critique.md).

## Le projet en une phrase

**Le Payfit de la zone UEMOA** : la paie sénégalaise (puis ouest-africaine) exacte des meilleurs cabinets, l'expérience produit des meilleurs SaaS mondiaux (Stripe, Linear), au prix du marché ouest-africain — avec l'APIX comme client fondateur et une commercialisation PME/ETI ensuite.

## Sommaire du dossier

| #   | Chapitre                                                                 | Contenu                                                                                              |
| --- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 01  | [Vision produit et périmètre fonctionnel](01-vision-produit.md)          | Marché, différenciation, personas, 14 modules, périmètre MVP → V1 → V2, 10 principes produit         |
| 02  | [Architecture technique globale](02-architecture-technique.md)           | Monolithe modulaire NestJS, multi-tenancy RLS, stack TypeScript, API REST, patterns transverses      |
| 03  | [Modèle de données et domaines (DDD)](03-modele-donnees.md)              | 8 bounded contexts, Person/User/Employee, effective dating, RLS, audit, conventions                  |
| 04  | [Moteur de paie, sécurité et conformité](04-paie-securite-conformite.md) | Moteur pur + packs pays versionnés, pack Sénégal, RBAC, RGPD + loi 2008-12/CDP, chiffrement          |
| 05  | [Design system, UX et ergonomie](05-design-system-ux.md)                 | Qualité Stripe/Linear décomposée, shadcn/ui + tokens, DataTable unique, run de paie UX, budgets perf |
| 06  | [Infrastructure, DevOps et exploitation](06-infrastructure-devops.md)    | Scaleway Paris + offre souveraine SENUM, CI/CD, backups/PITR, observabilité, coûts par stade         |
| 07  | [Modèle économique et stratégie SaaS](07-modele-economique.md)           | Pricing XOF 3 plans, encaissement sans Stripe, relation APIX & PI, go-to-market, métriques           |
| 08  | [Roadmap de construction et plan d'exécution](08-roadmap.md)             | Phases 0→4, ordre de construction, discipline qualité, anti-scope-creep, 10 décisions semaine 1      |
| 09  | [Revue critique et arbitrages](09-revue-critique.md)                     | Les deux revues adverses intégrales, les 3 blocages levés, le backlog des manques à combler          |
| 10  | [Scénario Trésor public](10-scenario-tresor-public.md)                   | La paie APIX si le Trésor verse les salaires : 2 scénarios, checklist de questions pour la RH        |

## Les 12 décisions structurantes

1. **Positionnement** : paie UEMOA native + expérience employé de classe mondiale. La barrière défendable est le moteur de paie réglementaire (IPRES, CSS, IR/TRIMF, CFCE, convention collective) — le fossé de Payfit, transposé.
2. **Pilote APIX en deux lots contractualisés** _(arbitrage post-revue)_ : Lot 1 = Core HR + congés & absences + portail employé + documents ; Lot 2 = paie sénégalaise. La paie fait partie de l'engagement MVP, mais elle est livrée en second, sur des données Core HR déjà fiabilisées.
3. **Monolithe modulaire TypeScript** (NestJS + Next.js), 8 bounded contexts aux frontières outillées, monorepo pnpm/Turborepo. Microservices, Kafka, Kubernetes, GraphQL : explicitement interdits en phase de construction.
4. **Multi-tenancy en schéma partagé** : `tenant_id` sur toutes les tables + Row-Level Security Postgres forcée, unicité et index scoppés au tenant ; extraction des gros clients vers une base dédiée plus tard par réplication logique.
5. **Person / User / Employee séparés** : une personne physique ≠ son compte d'accès ≠ ses dossiers d'emploi. Rend natifs le multi-entités, les prestataires, les candidats — et le futur multi-dossiers expert-comptable.
6. **Effective dating généralisé** : les données à effet temporel (affectations, salaires, barèmes légaux) sont des tables versionnées à `daterange` + contrainte d'exclusion GiST. Une paie doit rester recalculable à l'identique des années plus tard.
7. **Moteur de paie = fonction pure + packs pays immuables versionnés** (ex. SN-2026.1), traces de calcul par ligne de bulletin, bulletins scellés, validation par golden files de bulletins réels + paie en double sur 3 cycles avant bascule. Tous les taux marqués « à vérifier » jusqu'à validation par expert-comptable sénégalais.
8. **Front** : shadcn/ui (Radix) + Tailwind possédés dans `packages/ui`, tokens compilés par Style Dictionary, un unique composant DataTable, autosave sur les formulaires longs. **PWA Next.js comme seule cible mobile jusqu'à la V1+** _(arbitrage post-revue : Expo/RN sort du socle initial)_.
9. **Hébergement Scaleway Paris** (VPS + Coolify, PostgreSQL managé PITR) + **offre souveraine single-tenant** déployable chez Sénégal Numérique grâce au packaging 100 % Docker. Démarche CDP (autorisation de transfert, pas simple déclaration) à engager **avant** la Phase 0.
10. **Pricing en XOF par employé/mois** : Essentiel 1 500 / Pro 3 000 / Entreprise ≥ 5 000 XOF, planchers mensuels, -15 % annuel. Encaissement : PayDunya + Wave Business + virement (Stripe indisponible au Sénégal pour encaisser).
11. **Société éditrice distincte (SAS OHADA)** et clause de propriété intellectuelle non négociable avec l'APIX : licence d'usage + remise design partner limitée dans le temps, jamais de cession ni d'exclusivité. À valider avec un avocat marchés publics/OHADA.
12. **Aucun code spécifique APIX, jamais** : toute demande particulière passe par champs custom (JSONB + registry), workflows configurables ou feature flags par tenant.

## Arbitrages rendus après revue adverse

La revue croisée a identifié 3 points bloquants, tous arbitrés (détail et justifications dans [09-revue-critique.md](09-revue-critique.md)) :

| Blocage                                                                                 | Arbitrage                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contradiction ch.01/ch.08 : paie dans le MVP vs exclue du MVP                           | **Pilote APIX en 2 lots contractualisés dès la signature** : Lot 1 sans paie (fiabilisation Core HR/congés), Lot 2 = paie avec date cible et critères d'acceptation. Périmètre signé par l'APIX en semaine 1.                                                                           |
| Plan capacité insincère (fondateur à 50-60 %, chiffrages incompatibles entre chapitres) | **Calendrier honnête publié** : à capacité constante, V1 commercialisable à 20-24 mois. L'horizon 12-15 mois n'existe que si le dev n°2 rejoint dès la Phase 1 **et** que la capacité fondateur remonte à ≥ 80 % pour la Phase 2 (paie). Lancement Phase 2 conditionné à ces prérequis. |
| Aucun plan de financement face à un client public payant à 60-120 jours                 | **Volet trésorerie/runway 24 mois à produire avant le premier commit** (burn mensuel, sources : fonds propres, prestation APIX, DER/FJ, pré-ventes annuelles), avec jalons go/no-go financiers. Chantier ouvert, voir backlog ci-dessous.                                               |

Deux inconnues réglementaires sont à lever **avant** d'écrire du code :

- **CDP** : la loi 2008-12 soumet le transfert transfrontalier (hébergement Paris) à **autorisation préalable** — position écrite de la CDP et de la DSI APIX exigée avant la Phase 0 ; plan B single-tenant chez Sénégal Numérique déjà prévu par l'architecture.
- **Mobile money (V1)** : le versement des salaires doit être conçu en « initiation de paiement depuis le compte de l'employeur » (les fonds ne transitent jamais par la plateforme, sinon agrément BCEAO d'établissement de paiement), avec plafonds de wallets vérifiés et fallback virement multi-rails. À valider par un avocat réglementaire BCEAO avant de vendre la feature.

## Backlog documentaire (manques identifiés par la revue)

À traiter comme des extensions du dossier, par ordre de priorité :

1. **Reprise de données** (chapitre à créer — chantier n°1 de tout déploiement paie) : gabarits d'import Excel/Sage, matricules, cumuls de paie YTD, soldes de congés initiaux, ancienneté, recette signée avant tout run réel.
2. **Complétude réglementaire paie Sénégal** : IPM (obligatoire, absente du pack initial), acomptes/avances/prêts, saisies-arrêts et quotité saisissable, solde de tout compte et documents de sortie (certificat de travail, attestations), heures supplémentaires, avantages en nature, prime d'ancienneté et allocation de congés CCNI, jours fériés mobiles (Korité, Tabaski).
3. **Sorties aval de la paie** : fichier de virement bancaire (format banque APIX), journal/livre de paie, état des cotisations par organisme, export d'écritures comptables SYSCOHADA.
4. **Conduite du changement / déploiement client** : sponsor exécutif APIX, relais métier, formation par persona, hypercare 2 cycles de paie, support WhatsApp Business, critères d'adoption progressifs.
5. **Workflow d'approbation à N niveaux + délégations/intérims** (réalité du secteur public) — dès le MVP congés, après cartographie du circuit réel APIX.
6. **Audit de la population APIX** (prérequis Phase 2) : contractuels, fonctionnaires détachés (régime FNR ≠ IPRES), stagiaires, consultants — le « régime social » devient un attribut du dossier employé.
7. **Plan de financement et trésorerie 24 mois** (cf. arbitrage ci-dessus).
8. **Veille réglementaire récurrente** : partenariat contractualisé avec un cabinet d'expertise comptable (veille + certification de chaque release de pack pays), intégré au COGS ; organisation du support paie N2.
9. **Multi-établissements** (immatriculations CSS distinctes, ventilation des déclarations) : entité `establishment` dès le schéma MVP.
10. **Multi-dossiers expert-comptable minimal avancé en V1** (un User rattaché à N tenants + switcher) — le canal de vente n°1 doit avoir son outil.
11. Déclarations DGID/IPRES/CSS : instruction des portails/formats réels ; validité juridique du bulletin dématérialisé au Sénégal ; durées légales de conservation (droit du travail) ; pentest + trajectoire ISO 27001 ; roadmap i18n (en/wolof) ; conformité Côte d'Ivoire (ARTCI) avant l'expansion V2.

## Prochaines étapes

1. Valider ce dossier (et le nom de code) — puis geler les 10 décisions de la semaine 1 par ADR ([ch. 08](08-roadmap.md), §9).
2. Lever les 2 inconnues réglementaires (CDP, montage mobile money) et cadrer l'engagement design partner APIX par écrit (2 lots, PI, accès aux bulletins anonymisés, disponibilité de l'expert-comptable).
3. Produire le volet financement (backlog #7).
4. Lancer la Phase 0 « Fondations » : monorepo, auth, multi-tenancy + RLS, RBAC, audit log, effective dating, i18n, design system minimal, CI/CD — et rien d'autre.
