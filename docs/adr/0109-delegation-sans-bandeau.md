# ADR-0109 : La délégation se règle dans « Déléguer des tâches », sans bandeau sur les pages

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0025](0025-gestion-des-acces-deleguee.md)

## Contexte

Chaque page de la DCH qu'une délégation ouvre portait un bandeau en tête. À
qui dirige la DCH, il disait « Vous pouvez déléguer … à votre équipe », ou le
nom des membres délégués, avec un bouton « Déléguer » ; au membre délégué,
« La DCH vous a délégué … ». Douze pages en avaient un : la gestion du
personnel, la gestion des accès, l'organigramme, les paramètres des
absences, les jours fériés, les offres d'emploi, les dossiers de
candidature, la gestion de l'APIX Academy, et les files des absences et
congés, des demandes de documents, des mises à jour d'informations et de la
vérification des documents.

La page « Déléguer des tâches » règle déjà toutes ces délégations. L'APIX
demande d'enlever ces bandeaux partout.

## Décision

**La délégation se règle dans « Déléguer des tâches », et seulement là.**
Les pages ne portent plus ni bandeau de délégation ni bouton « Déléguer »,
pour personne : ni « Vous pouvez déléguer … » ou « Awa peut désormais … »
pour qui dirige la DCH, ni « La DCH vous a délégué … » pour un membre.

**Ce que donne une délégation ne change pas** : les habilitations, la file
de chacun (ADR-0060), « Déléguer à un membre de la DCH » sur sa propre
demande.

**Le bandeau orange de la chaîne hiérarchique reste** sur la gestion du
personnel : il dit des dossiers à compléter, pas une délégation.

## Conséquences

- L'ADR-0025 confiait la gestion des accès « depuis « Déléguer des tâches »
  ou depuis le bandeau de la page » : c'est désormais depuis « Déléguer des
  tâches » seulement.
- Le menu « Déléguer » d'une page et la fenêtre « Déléguer » type par type
  quittent le code ; « Déléguer des tâches » garde ses propres coches.
- Un membre délégué ne lit plus en tête de page ce qui lui est délégué : il
  le voit à son menu, où la page s'ajoute. « Déléguer des tâches » reste
  réservée à qui dirige la DCH et à l'administrateur.
