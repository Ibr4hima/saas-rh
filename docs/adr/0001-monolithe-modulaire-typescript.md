# ADR-0001 — Monolithe modulaire TypeScript

**Statut** : acceptée · 2026-08-17

## Contexte

Équipe de 1-2 développeurs visant un SaaS RH/paie de niveau mondial (cf. ch. 02). Les microservices multiplient les coûts d'exploitation et de cohérence sans bénéfice avant ~8 développeurs.

## Décision

Un seul déployable backend **NestJS** (Node 22, TypeScript strict) organisé en 8 bounded contexts (modules aux frontières outillées par ESLint boundaries), un frontend **Next.js**, un monorepo **pnpm + Turborepo** avec paquets partagés (`contracts`, `ui`, futur `payroll-engine`). Événements internes via **outbox pattern** dans Postgres relayé par pg-boss.

## Interdits explicites (tant que l'équipe < ~8 devs)

Microservices, Kafka, Kubernetes, GraphQL, CQRS/event sourcing généralisé, moteur de recherche dédié.

## Conséquences

Extraction d'un service possible plus tard le long des frontières de modules ; discipline de frontières vérifiée en CI ; un seul pipeline de déploiement.
