# ADR-0182 : L'offre : le français d'office, le niveau de chaque langue, l'expérience pour le poste

**Statut** : acceptée · 2026-11-07

## Contexte

Le profil recherché d'une offre (migrations 0056 et 0058) se choisit dans
des listes : niveau d'études, expérience minimum, langues exigées parmi
l'anglais, le mandarin, l'espagnol, l'arabe et l'italien. Le français n'y
figurait plus, alors que tout poste de l'APIX l'exige. Une langue cochée ne
disait pas à quel niveau, et l'expérience ne distinguait pas les années de
métier de celles passées sur un poste comparable.

## Décision

**Le français est exigé sur toute offre.** Il ouvre la liste des langues,
coché, et ne se décoche pas. Il ne s'enregistre pas : l'offre l'affiche
toujours, les plus anciennes comprises.

**Toute autre langue cochée demande son niveau à l'oral, à l'écrit et en
compréhension**, chacun parmi Notions, Intermédiaire, Courant et Bilingue.
Les trois sont obligatoires ; l'offre ne s'enregistre pas sans eux. Une
offre plus ancienne garde ses langues sans niveau, jusqu'à sa prochaine
modification.

**« Expérience pour le poste » rejoint « Expérience minimum »**, avec les
mêmes paliers, obligatoire. Elle ne dépasse jamais l'expérience minimum :
le formulaire ne propose que les paliers inférieurs ou égaux, et l'API
refuse le reste.

## Conséquences

- La migration 0132 ajoute `experience_poste` et `niveaux_langues` (les
  niveaux de chaque langue cochée) à `job_postings`.
- Dans l'API, `langues` porte pour chaque langue ses trois niveaux ; une
  langue d'une offre ancienne a des niveaux nuls.
- La page publique et la fiche de l'offre montrent le français, puis chaque
  langue avec ses niveaux, et l'expérience pour le poste.
