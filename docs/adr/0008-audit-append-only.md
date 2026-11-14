# ADR-0008 — Audit log append-only et immutabilité paie

**Statut** : acceptée · 2026-08-17

## Contexte

Exigence CDP/RGPD, secteur public, et différenciateur enterprise : savoir qui a changé quoi, quand, avec quelles valeurs avant/après.

## Décision

Table `audit_log` **append-only** (UPDATE/DELETE révoqués au niveau SQL, partitionnement par mois quand le volume l'exigera), alimentée par triggers portant le contexte applicatif (`app.user_id`, `app.tenant_id`, request id). Les bulletins émis seront scellés par hachage chaîné (Phase 2). Aucune suppression physique sur les données de paie et d'audit ; soft delete sélectif ailleurs.

## Conséquences

Les settings de session applicatifs (`app.*`) sont posés par le même helper que le contexte RLS ; la purge RGPD des données personnelles passe par des procédures dédiées documentées, jamais par DELETE direct.
