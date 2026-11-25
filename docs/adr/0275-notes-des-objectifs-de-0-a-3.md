# ADR-0275 : Les objectifs se notent de 0 à 3, avec le relevé des notes et leur moyenne

**Statut** : acceptée · 2026-11-24 · révise l'[ADR-0215](0215-formulaire-d-auto-evaluation.md) et l'[ADR-0216](0216-evaluation-par-le-n1.md), complète l'[ADR-0244](0244-fiche-sans-objectif-sans-echelle.md)

## Contexte

Dans son auto-évaluation, l'agent donnait à chaque objectif une lettre de A
à D (ADR-0215) ; après l'entretien, le N+1 faisait de même (ADR-0216).
L'APIX veut quantifier le résultat : chaque objectif reçoit une note
chiffrée, et la fiche calcule la moyenne, comme le relevé des notes de
l'ancienne grille du personnel non cadre (ADR-0155).

## Décision

**Une note de 0 à 3 remplace la lettre**, chez l'agent comme chez le N+1,
avec le même sens :

| Note | Atteinte              | Résultats       |
| ---- | --------------------- | --------------- |
| 3    | Dépassé               | excellents      |
| 2    | Réalisé               | satisfaisants   |
| 1    | Partiellement réalisé | à améliorer     |
| 0    | Non réalisé           | non acceptables |

Chaque note garde la couleur de la lettre qu'elle remplace, de 3 en vert à
0 en rouge. Elle reste obligatoire pour transmettre, et 0 est une note. Les
compétences, la compréhension et la tenue du poste gardent leurs lettres.

**Le relevé des notes obtenues**, sous les objectifs, sur le modèle de
l'ancienne grille : chaque objectif avec sa note à l'auto-évaluation et
chez le N+1, puis la moyenne de chaque colonne, sur 3, à deux décimales
(« 2,33 / 3 »). Une moyenne s'affiche une fois tous les objectifs notés ;
avant, des points de suspension tiennent sa place. Le tableau suit la
saisie, note après note.

- Dans l'auto-évaluation : la note de l'agent seule.
- Chez le N+1, et en lecture pour l'agent, le N+2 et la DCH : les deux
  colonnes.
- Dans le PDF : sous l'échelle, maintenant de 3 à 0. La partie de l'agent
  seule (ADR-0241) n'a que sa colonne ; sur la fiche vierge, les notes se
  cochent et les moyennes s'écrivent à la main. Sans objectif, ni échelle
  ni relevé (ADR-0244).

**Les fiches déjà écrites** se relisent sans migration : A vaut 3, B 2, C 1
et D 0. La base garde la lettre jusqu'au prochain enregistrement, qui
écrit la note. Dans le contrat, le champ s'appelle `note` (`niveau` avant).

## Conséquences

- La moyenne est une moyenne simple : chaque objectif compte autant.
- L'ancienne grille (ADR-0149, ADR-0155) ne change pas.
- Les objectifs transmis pendant la fixation des objectifs (ADR-0274) se
  noteront ainsi à l'évaluation de fin d'année.
