# ADR-0036 : Le responsable d'un département ou d'un service se choisit dans la direction

**Statut** : acceptée · 2026-10-08

## Contexte

L'ADR-0013 (décision 3) veut qu'un responsable travaille dans l'unité qu'il
dirige, et la désignation n'acceptait que des agents déjà affectés à l'unité
ou à ce qui en dépend. Un département ou un service qui vient d'être créé n'a
personne : on ne pouvait y nommer aucun responsable, alors que la direction
au-dessus compte des agents.

## Décision

**Le responsable d'un département ou d'un service se choisit parmi les agents
de sa direction**, dans n'importe laquelle de ses unités. La désignation
l'affecte à l'unité qu'il dirige, avec le poste de responsable, à la date de
prise de fonction (ADR-0033) ; son n+1 devient celui qu'impose sa place
(ADR-0034).

Un directeur se choisit toujours dans sa direction, le DG à la Direction
Générale.

Une personne ne dirige qu'une unité : ni le directeur ni le chef d'une autre
unité ne sont proposés. Les stagiaires non plus.

## Conséquences

- L'invariant de l'ADR-0013 tient toujours : une fois désigné, le responsable
  travaille dans l'unité qu'il dirige.
- Un agent d'une autre direction se mute d'abord, ou se désigne par la case
  « Désigner comme responsable » d'une nouvelle affectation, qui fait les deux
  d'un geste.
