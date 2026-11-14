# ADR-0020 : Au retour, la RH décide ce que l'agent reprend

**Statut** : acceptée · 2026-10-06

## Contexte

ADR-0019 rendait d'office à un agent qui revient la tête des unités restées
sans responsable, et son équipe avec. Revenir ne veut pas dire reprendre
le même poste : un directeur peut revenir sur une autre fonction. C'est à
la RH d'en décider.

## Décision

**Rien n'est rendu d'office.** Au retour, la RH coche ce que l'agent
reprend :

- dans « Nouveau contrat », pour un dossier inactif, ou pour un agent que
  ce contrat fera passer par une interruption : « Redevient responsable de
  « X » » pour chaque unité qu'il dirigeait (restée sans responsable, dans
  la direction choisie) ; « Reprend son équipe » s'il n'en dirigeait
  aucune ;
- dans « Réactiver », les mêmes cases.

Rien n'est coché par défaut. Une unité reprise ramène l'équipe qui y est
encore là où le départ l'avait mise. Le choix fait sur un contrat qui
commence plus tard se garde sur le contrat (`resume_unit_ids`,
`resume_team`) et s'applique le jour venu, si l'unité est toujours sans
responsable. À la reprise immédiate, une unité qui ne peut plus lui
revenir (successeur nommé, place hors de l'unité) est refusée avec un
message.

## Conséquences

- ADR-0019 reste valable pour ce que le départ note et pour l'annulation
  d'un contrat à venir ; seul le retour d'office est remplacé.
- Une réactivation groupée depuis la liste ne rend rien : elle ne pose pas
  la question.
