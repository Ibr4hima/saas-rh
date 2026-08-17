# Teranga RH

> SaaS de gestion RH et de paie pour l'Afrique de l'Ouest francophone — **nom de code provisoire**.

**Le Payfit de la zone UEMOA** : la paie sénégalaise (puis ouest-africaine) native et exacte, l'expérience produit des meilleurs SaaS mondiaux (Stripe, Linear, Payfit), au prix du marché ouest-africain.

- **Client fondateur** : APIX (design partner) — pilote en deux lots : Core HR + congés + portail employé, puis paie sénégalaise.
- **Cible commerciale** : PME/ETI du Sénégal puis de la zone UEMOA, avec les experts-comptables comme canal de prescription.
- **Différenciation** : moteur de paie réglementaire UEMOA natif (IPRES, CSS, IR/TRIMF, CFCE, convention collective), souveraineté des données (loi 2008-12 / CDP), versement par mobile money, portail employé mobile-first tolérant aux coupures réseau.

## État du projet

**Phase actuelle : Phase 0 — Fondations (en cours).** Le dossier d'architecture est complet et les fondations irréversibles sont posées : monorepo pnpm/Turborepo, API NestJS, multi-tenancy avec RLS PostgreSQL forcée (rôle applicatif non-owner), effective dating (daterange + GiST), audit log append-only, auth Argon2id à sessions opaques — le tout couvert par un test d'étanchéité inter-tenant exécuté en CI contre un Postgres réel.

```bash
pnpm install && pnpm db:up && cp .env.example .env
pnpm db:migrate && pnpm dev   # web sur :3000, API sur :3001/v1/health
pnpm test                     # dont le test d'étanchéité RLS
```

📐 **[Dossier d'architecture complet → `docs/architecture/`](docs/architecture/README.md)**

| Contenu                                                                  | Document                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Synthèse exécutive, 12 décisions structurantes, arbitrages               | [docs/architecture/README.md](docs/architecture/README.md)                         |
| Vision produit, marché, personas, modules, MVP → V2                      | [01-vision-produit.md](docs/architecture/01-vision-produit.md)                     |
| Architecture technique (monolithe modulaire, multi-tenant RLS, stack TS) | [02-architecture-technique.md](docs/architecture/02-architecture-technique.md)     |
| Modèle de données, DDD, effective dating                                 | [03-modele-donnees.md](docs/architecture/03-modele-donnees.md)                     |
| Moteur de paie, sécurité, conformité CDP/RGPD                            | [04-paie-securite-conformite.md](docs/architecture/04-paie-securite-conformite.md) |
| Design system, UX, budgets performance                                   | [05-design-system-ux.md](docs/architecture/05-design-system-ux.md)                 |
| Infrastructure, DevOps, coûts                                            | [06-infrastructure-devops.md](docs/architecture/06-infrastructure-devops.md)       |
| Modèle économique, pricing XOF, relation APIX                            | [07-modele-economique.md](docs/architecture/07-modele-economique.md)               |
| Roadmap d'exécution et plan de construction                              | [08-roadmap.md](docs/architecture/08-roadmap.md)                                   |
| Revue critique adverse et arbitrages                                     | [09-revue-critique.md](docs/architecture/09-revue-critique.md)                     |
