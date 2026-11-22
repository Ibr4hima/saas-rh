# ADR-0250 : Les cartes des agents sans point de couleur, et sans la fiche dans « Mon équipe »

**Statut** : acceptée · 2026-11-22 · révise les ADR [0226](0226-auto-evaluation-faite-ou-non.md), [0227](0227-accueil-a-la-charte.md), [0234](0234-cartes-des-agents.md) et [0235](0235-statut-sur-les-cartes-de-l-equipe.md)

## Contexte

Sur l'accueil de la campagne, chaque carte d'agent portait, à hauteur du
nom, un point vert ou rouge : l'auto-évaluation faite ou non (ADR-0226,
ADR-0234). Dans « Mon équipe », le titre de chaque groupe en portait la
pastille, en légende (ADR-0227) ; une fois l'auto-évaluation faite, le
repère « Fiche » disait où en était l'évaluation, sous l'email : « À
évaluer », « Évaluation en cours »… (ADR-0235). L'APIX veut des cartes
plus sobres : sans les points, et sans la fiche dans « Mon équipe ».

## Décision

**Plus de point sur les cartes**, dans « Mon équipe » comme dans
« Commentaires du N+2 ». La pastille des titres de groupe, qui leur servait
de légende, disparaît aussi : le titre du groupe dit si l'auto-évaluation
est faite.

**Dans « Mon équipe », plus de repère « Fiche »** : la carte porte l'email
professionnel et le statut. Une auto-évaluation faite rend toujours la
carte cliquable ; la page de l'agent dit où en est son évaluation.

**Les cartes de « Commentaires du N+2 » gardent leur repère « Fiche »** :
« À commenter », « Commentaires transmis »… disent ce qui attend le N+2.

## Conséquences

- Sur l'accueil, le rouge ne dit plus l'auto-évaluation. La page de l'agent
  et le suivi de la DCH la disent toujours « Non faite », en rouge.
- Chez le N+2, la carte d'un agent dont l'auto-évaluation n'est pas faite
  n'a pas de repère « Fiche » : elle est rangée avec les évaluations en
  cours.
