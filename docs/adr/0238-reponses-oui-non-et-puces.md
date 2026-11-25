# ADR-0238 : Les réponses par oui ou non et en puces de l'auto-évaluation

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0215](0215-formulaire-d-auto-evaluation.md)

## Contexte

Dans l'auto-évaluation, chaque question se répondait par un texte libre ;
seules les deux questions du récapitulatif étaient obligatoires
(ADR-0215). L'APIX veut des réponses plus nettes : un oui ou un non
d'abord, quand la question le demande, et des listes à puces pour ce qui
s'énumère. Elle veut aussi toutes les questions des préoccupations et des
souhaits obligatoires, sauf « Autres commentaires ».

## Décision

**Deux questions se répondent d'abord par oui ou par non**, un choix
obligatoire : « Avez-vous rencontré des difficultés dans vos tâches ? Si
oui, lesquelles ? » et « Y a-t-il des compétences ou des qualités qui ne
sont pas assez exploitées dans votre poste ? ». Sur un oui, le champ
s'ouvre avec une première puce, le curseur dedans, et une puce écrite au
moins est demandée. Sur un non, il n'y a rien d'autre à remplir.

**Deux questions se répondent toujours en puces** : « Quelles missions
vous conviennent le mieux, et lesquelles souhaiteriez-vous développer ? »
et « Quelles sont les principales difficultés ou contraintes que vous
rencontrez dans votre travail ? ».

**Un champ en puces** se comporte comme ceux de la grille d'évaluation
(ADR-0153) : une puce au moins, toujours visible ; Entrée ouvre la puce
suivante, et ce qui suit le curseur y passe ; Retour arrière au début
d'une puce la rattache à la précédente ; les flèches passent d'une puce à
l'autre ; un texte collé sur plusieurs lignes donne autant de puces, sans
ses tirets.

**Obligatoires**, marquées d'un astérisque : en plus des deux questions du
récapitulatif, et du niveau et des résultats de chaque objectif, les
quatre questions des préoccupations et des souhaits. « Autres
commentaires », les commentaires des objectifs et les autres réalisations
restent libres. L'avancement compte six questions, et deux réponses par
objectif.

**À la lecture**, pour le N+1, le N+2, la DCH et l'agent, une question à
choix affiche « Oui » et ses puces, ou « Non » ; une question en puces, sa
liste. **Le PDF** imprime de même « Oui » et ses puces, ou « Non ».

**Les données** : la fiche garde ses textes ; une réponse en puces s'y
écrit une puce par ligne, et deux choix s'y ajoutent, `null` tant que rien
n'est choisi. Transmise, l'auto-évaluation part sans ses puces vides, et,
sur un non, sans la liste écrite avant de changer d'avis.

## Conséquences

- Pas de migration : l'auto-évaluation est gardée en JSON. Une
  auto-évaluation écrite avant ces choix se relit avec un choix déduit de
  sa réponse : rien d'écrit, pas de choix ; une réponse courte qui commence
  par « Non », « Aucune », « Néant » ou « Rien », non ; une autre, oui.
- Le choix Oui ou Non de l'application accepte désormais de n'avoir rien
  de choisi.
- La fiche vierge à imprimer ne change pas : ses lignes restent à remplir
  à la main.
