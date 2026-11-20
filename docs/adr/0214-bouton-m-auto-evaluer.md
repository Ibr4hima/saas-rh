# ADR-0214 : Le bouton « M'auto-évaluer » et la coche bleue de l'auto-évaluation faite

**Statut** : acceptée · 2026-11-20 · révise l'[ADR-0211](0211-mode-campagne-et-accueil.md)

## Contexte

Sur l'accueil de la campagne, la carte « Mon auto-évaluation » disait où en
était l'auto-évaluation par un badge (à venir, à faire, en cours, transmise,
non transmise), et rien ne permettait de la commencer.

## Décision

**Un bouton dans la fiche.** En haut à droite de la fiche de la personne,
sur la ligne de son nom : « M'auto-évaluer ». Il paraît pendant
l'auto-évaluation, tant qu'elle n'est pas transmise, et ouvre
`/evaluation-annuelle/auto-evaluation`. Sur téléphone, il passe sous le nom,
comme les autres gestes des en-têtes. C'est un lien qui a l'allure d'un
bouton principal : `classesDeBouton` de `@teranga/ui`, dont le composant
`Button` se sert aussi.

**Plus de badge, une coche bleue.** La carte « Mon auto-évaluation » ne
garde que sa période. Une fois l'auto-évaluation transmise, la coche bleue de
la plateforme (le sceau) se pose à côté du titre ; la date de la
transmission se lit en infobulle et par les lecteurs d'écran.

**La page de l'auto-évaluation.** `/evaluation-annuelle/auto-evaluation`
montre pour l'instant son en-tête : le titre et la période. Le formulaire,
les sections de la fiche d'entretien que l'agent remplit, s'y ajoute à
l'étape suivante. Sans auto-évaluation à faire (au sommet de
l'organigramme, en stage), la page renvoie à l'accueil.

## Conséquences

- Sur la fiche d'un agent de son équipe, l'évaluateur garde le badge de
  l'auto-évaluation (« Faite le 18 nov. », « En cours », « Non commencée »).
- Une fois la période de l'auto-évaluation passée, une auto-évaluation non
  transmise n'a plus de marque : la règle de ce cas reste à fixer.
