# ADR-0007 — Moteur de paie : fonction pure + packs pays immuables

**Statut** : acceptée · 2026-08-17 (implémentation en Phase 2)

## Contexte

Cœur différenciant du produit (ch. 04). Tolérance zéro erreur ; chaque ligne de bulletin doit être explicable et rejouable des années plus tard.

## Décision

Le moteur est un **paquet TypeScript pur, déterministe, sans I/O** : mêmes entrées + même version de pack = même bulletin au franc CFA près. Le noyau ne contient **aucune constante légale** ; chaque pays est un **pack immuable versionné** (ex. `SN-2026.1`) : rubriques, barèmes effective-dated, séquencement. Validation : golden files de bulletins réels approuvés par expert-comptable + property-based testing + paie en double 3 cycles avant toute bascule.

## Conséquences

Le schéma de données paie (runs, bulletins, lignes, rubriques par pays) est posé dès les fondations ; les traces de calcul par ligne sont stockées ; les périodes clôturées sont verrouillées (régularisation = run de rappel, jamais de réouverture).
