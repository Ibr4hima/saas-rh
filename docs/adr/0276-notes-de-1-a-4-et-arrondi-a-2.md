# ADR-0276 : Les objectifs se notent de 1 à 4, et le N+1 peut arrondir la moyenne à 2 en le justifiant

**Statut** : acceptée · 2026-11-24 · révise l'[ADR-0275](0275-notes-des-objectifs-de-0-a-3.md)

## Contexte

L'ADR-0275 notait chaque objectif de 0 à 3. L'APIX préfère une note de 1 à
4, avec une moyenne sur 4 : à 2, l'agent a atteint ses objectifs de
l'année. Juste en dessous, des circonstances atténuantes peuvent expliquer
l'écart : une longue absence, un projet suspendu, des moyens arrivés en
retard. Le N+1 doit alors pouvoir arrondir la moyenne à 2, à condition de
justifier cette décision.

## Décision

**Une note de 1 à 4 remplace celle de 0 à 3**, chez l'agent comme chez le
N+1, avec le même sens :

| Note | Atteinte              | Résultats       |
| ---- | --------------------- | --------------- |
| 4    | Dépassé               | excellents      |
| 3    | Réalisé               | satisfaisants   |
| 2    | Partiellement réalisé | à améliorer     |
| 1    | Non réalisé           | non acceptables |

Les couleurs suivent : 4 en vert, 1 en rouge. Le relevé des notes obtenues
donne chaque moyenne sur 4 (« 2,33 / 4 ») ; dans le PDF, l'échelle va de 4
à 1.

**Une moyenne de 2 sur 4 atteint les objectifs de l'année.**

**L'arrondi à 2.** Quand la moyenne du N+1 va de 1,5 (compris) à 2 (non
compris), la case « Arrondir à 2 » apparaît sous le relevé, dans la saisie
du N+1. Une fois cochée, la case ouvre le champ « Justification de
l'arrondi », obligatoire : sans justification, l'évaluation ne part pas
(422, `campagne.evaluation_incomplete`, « la justification de
l'arrondi »). Hors de cette plage, la case n'apparaît pas. Le brouillon
garde la case et la justification ; si une note change ensuite et sort la
moyenne de la plage, la transmission retire l'arrondi.

Arrondie, la moyenne calculée reste affichée, et une ligne « Moyenne
retenue », à 2,00 / 4, ferme le relevé. La justification suit le relevé
partout où l'évaluation se lit : chez l'agent, le N+2 et la DCH, et dans le
PDF. Sur la fiche vierge, une case « Arrondi à 2 » et des lignes pour la
justification suivent le relevé.

L'arrondi ne porte que sur la moyenne du N+1 ; l'auto-évaluation n'en a pas.
Dans le contrat, l'évaluation du N+1 gagne `arrondi` et
`justificationDeLArrondi`.

**Les notes déjà données** : la migration 0146 ajoute 1 aux notes de 0 à 3
écrites depuis l'ADR-0275, dans l'auto-évaluation comme dans l'évaluation du
N+1 : 0 devient 1, 3 devient 4. Les lettres plus anciennes se relisent
toujours à la volée : A vaut 4, B 3, C 2 et D 1.

## Conséquences

- Les libellés de l'échelle restent ceux de la fiche S1/EN05 : une note de 2
  se lit « Partiellement réalisé », alors qu'une moyenne de 2 atteint les
  objectifs.
- On n'arrondit qu'à 2, et jamais une moyenne sous 1,5.
- La moyenne reste une moyenne simple : chaque objectif compte autant.
