# ADR-0004 — Pilote APIX en deux lots contractualisés

**Statut** : acceptée · 2026-08-17

## Contexte

Contradiction relevée en revue (A1) : paie « dans le MVP » (ch. 01) vs « exclue du MVP » (ch. 08). Par ailleurs, hypothèse Trésor public à confirmer (doc 10).

## Décision

Le pilote APIX est contractualisé **en deux lots dès la signature** : Lot 1 = Core HR + congés & absences + portail employé + documents/attestations ; Lot 2 = paie (périmètre exact conditionné aux réponses de la checklist du doc 10 — moteur complet ou interface Trésor). Dates cibles et critères d'acceptation signés par l'APIX.

## Conséquences

Le Lot 1 démarre sans attendre la décision paie ; le schéma de données paie est posé dans les fondations dans les deux cas ; l'engagement design partner doit inclure PI (ADR société éditrice, ch. 07), bulletins anonymisés et disponibilité de l'expert-comptable.
