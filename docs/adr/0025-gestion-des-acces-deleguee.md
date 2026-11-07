# ADR-0025 : La gestion des accès se délègue

**Statut** : acceptée · 2026-10-07

## Contexte

ADR-0017 réservait la page « Gestion des accès » au directeur du Capital
Humain. Suivre qui est entré sur le portail et relancer les invitations
est un travail courant, que la DCH veut confier comme les autres tâches
de « Déléguer des tâches ».

## Décision

**Une habilitation de plus : `acces`.** Le directeur du Capital Humain la
détient, et la confie à des membres de sa direction, depuis « Déléguer des
tâches » ou depuis le bandeau de la page. Elle ouvre la page et l'envoi
des invitations, rien d'autre.

**Ce que la délégation ne donne pas.** Couper ou rétablir un accès reste
sur la fiche, à la gestion du personnel. Un délégué n'invite ni le
directeur du Capital Humain, ni le directeur général, ni un compte
administrateur (ADR-0024). Sans la consultation des dossiers, il lit le
nom de chaque agent, sans lien vers sa fiche.

**L'administrateur ne l'a pas d'office.** Comme les dossiers de
candidature, la gestion des accès est tenue par la DCH : un administrateur
l'a s'il dirige la DCH ou qu'elle la lui confie.

## Conséquences

- La page n'est plus réservée au directeur ; le refus
  `acces.reserve_au_directeur` disparaît au profit du refus commun des
  habilitations.
- L'envoi groupé des invitations s'ouvre à `personnel.gerer` ou à `acces`.
