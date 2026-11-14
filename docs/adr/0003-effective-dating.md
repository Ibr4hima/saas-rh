# ADR-0003 — Effective dating par tables versionnées

**Statut** : acceptée · 2026-08-17

## Contexte

Les données RH sont temporelles par nature (salaire au 1er mars, poste au 1er juin, barème au 1er janvier). Une paie doit rester recalculable à l'identique des années plus tard. L'event sourcing complet est écarté (over-engineering pour l'équipe).

## Décision

Les attributs à effet temporel (affectations, rémunérations, barèmes légaux) vivent dans des **tables de versions** avec `validity daterange` (`[valid_from, valid_to)`), une **contrainte d'exclusion GiST** interdisant les chevauchements par entité, et jamais d'UPDATE destructif : on clôt une version et on en ouvre une autre. L'état courant est une projection à une date (`validity @> date`).

## Conséquences

Extension `btree_gist` requise ; les requêtes « à date » sont un helper standard du socle ; les barèmes des packs pays suivront le même patron (bitemporel : + date de publication) en Phase 2.
