# ADR-0046 : Le formateur d'une formation est obligatoire

**Statut** : acceptée · 2026-10-09

## Contexte

Une formation de l'APIX Academy pouvait se créer sans formateur (« Non
précisé »). La fiche d'un agent récapitule pourtant les formations
dispensées, et le formateur n'en passe pas l'évaluation : un formateur
inconnu laissait ces deux règles sans objet.

## Décision

**Toute formation a un formateur** : un agent de l'APIX, choisi par son nom
et son matricule, ou une personne externe, par son nom. « Non précisé »
disparaît ; l'API refuse une formation sans formateur, à la création comme à
la modification.

**Les choix se nomment « Agent de l'APIX » et « Externe ».** La fenêtre dit
ce que le rôle emporte : pas de certification de la formation, et un
récapitulatif des formations dispensées sur la fiche personnelle.

## Conséquences

- Une formation créée avant reste sans formateur jusqu'à sa prochaine
  modification, qui demande d'en choisir un.
- La liste des agents à désigner porte le matricule plutôt que le poste :
  deux homonymes se distinguent.
