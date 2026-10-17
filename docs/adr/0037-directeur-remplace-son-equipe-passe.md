# ADR-0037 : Directeur remplacé : son équipe passe au nouveau directeur

**Statut** : acceptée · 2026-10-08

## Contexte

L'ADR-0035 fait passer l'équipe d'un chef de département ou de service au
chef qui le remplace, et laissait aux directeurs leur règle d'avant :
l'ancien directeur gardait ses agents directs.

## Décision

**Quand un directeur est remplacé, ceux qui relevaient de lui passent sous le
nouveau directeur** (motif `suit_le_directeur`). Ils restent à la direction :
ils ne suivent pas l'ancien directeur dans ses mouvements, qu'il reste dans la
direction ou qu'il parte ailleurs. L'ancien directeur, s'il reste dans la
direction, relève du nouveau, comme avant.

La règle est désormais la même à chaque niveau : DG, directeur, chef de
département ou de service.

## Conséquences

- Un directeur retiré sans successeur garde ses agents : personne n'est là
  pour les reprendre.
- Muté après la relève, l'ancien directeur n'a plus d'équipe à confier.
