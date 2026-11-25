# ADR-0255 : « Fiches d'évaluation à commenter » : sur l'accueil du N+2, les seules fiches arrivées chez le N+2

**Statut** : acceptée · 2026-11-22 · révise l'[ADR-0218](0218-commentaires-du-n2.md)

## Contexte

Sur l'accueil du N+2, la section « Commentaires du N+2 » réunissait les
agents des équipes de ses N+1, en deux groupes : les fiches validées par
l'agent, qui s'ouvrent pour les commentaires, et les autres, avec l'étape
où elles en étaient (« Évaluation en cours »). Le N+2 voyait ainsi des
fiches encore chez le N+1 ou chez l'agent. L'APIX ne veut montrer au N+2
que les fiches arrivées chez le N+2, sous un autre titre.

## Décision

**La section s'appelle « Fiches d'évaluation à commenter »**, et « Fiche
d'évaluation à commenter » quand il n'y en a qu'une.

**Elle ne réunit que les fiches arrivées chez le N+2**, celles que l'agent
a validées : la fiche arrive chez le N+2 à la validation de l'agent, sans
geste du N+1 (ADR-0218). Les cartes ne sont plus réparties en groupes.
Tant qu'aucune fiche n'est arrivée chez le N+2, la section ne s'affiche
pas.

**Sur chaque carte, le N+1 a sa case**, « N+1 », à côté de l'email
professionnel, au lieu d'une ligne « N+1 : … » sous le poste. Dessous,
« Fiche » dit où en sont les commentaires : « À commenter »,
« Commentaires en cours », « Commentaires transmis » ou « Reprise par le
N+1 ».

**L'API ne renvoie plus que ces fiches** dans `aCommenter` : le N+2 ne
reçoit plus rien d'une fiche encore chez le N+1 ou chez l'agent.

## Conséquences

- Depuis son accueil, le N+2 ne suit plus l'avancement des fiches des
  équipes de ses N+1 avant leur validation par l'agent.
- La page d'une fiche pour le N+2 ne change pas : avant la validation de
  l'agent, elle dit seulement où en est la fiche.
