# ADR-0125 : L'accès au portail ne se coupe plus à la main

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0025](0025-gestion-des-acces-deleguee.md) et l'[ADR-0047](0047-sessions-et-signalement.md)

## Contexte

La fiche d'un agent proposait « Couper l'accès » : ses sessions se fermaient
sur tous ses appareils, et la connexion restait refusée jusqu'à ce qu'on la
rétablisse. « Gestion des accès » rangeait ces comptes sous un onglet,
« Accès coupés ». L'APIX ne veut pas de ce geste : ce n'est pas à la DCH de
couper un accès, il se ferme de lui-même selon les règles déjà définies
(ADR-0016 : trente jours après le départ, le jour même pour un licenciement
ou un décès). Sur la fiche d'un compte actif, la ligne « Compte actif »
redisait aussi le badge.

## Décision

**L'accès ne se coupe plus à la main.** Le bouton « Couper l'accès » et sa
fenêtre quittent la fiche ; la route `POST /v1/employees/:id/acces/couper`
disparaît. L'onglet « Accès coupés » quitte « Gestion des accès ».

**Un accès coupé avant se rétablit encore.** La connexion reste refusée, la
fiche le dit et propose « Rétablir l'accès », aux mêmes conditions qu'avant
(ADR-0024) ; « Gestion des accès » le montre sous « Tous », avec son badge.
Rien ne le rétablit d'office : une coupure a pu suivre une fraude.

**Un compte actif n'a que son badge** : le bloc « Accès au portail » d'un
compte actif porte son titre et « Compte actif », sans ligne ni bouton
dessous.

## Conséquences

- Un appareil perdu se déconnecte en changeant de mot de passe par « Mot de
  passe oublié » : toutes les sessions du compte se ferment.
- La fiche ne dit plus qu'un compte actif est un compte d'administration.
