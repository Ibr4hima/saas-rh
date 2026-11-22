# ADR-0256 : « Suivi des évaluations » : un bouton dans la barre, à gauche de la date, à la place de la tuile

**Statut** : acceptée · 2026-11-22 · révise les ADR [0221](0221-transmission-a-la-dch.md) et [0227](0227-accueil-a-la-charte.md)

## Contexte

Pour qui a l'habilitation « Tableau de bord », l'accueil de la campagne
portait sous le bandeau une tuile « Suivi de la DCH », avec le nombre de
fiches transmises et une jauge (ADR-0221, ADR-0227). L'APIX veut retirer
cette tuile et ouvrir le suivi depuis un bouton « Suivi des évaluations »
placé dans la barre du haut, à gauche de la date.

## Décision

**La tuile « Suivi de la DCH » disparaît de l'accueil.** Pour un compte
d'administration, la tuile de l'administration de la campagne reste.

**La barre porte le bouton « Suivi des évaluations »**, à gauche de la
date du jour, sur toutes les pages de la campagne, pour qui a
l'habilitation « Tableau de bord ». En mode clair, il est bleu, au bleu de
la charte, écrit en blanc ; en mode sombre, blanc, écrit en bleu. Pas
d'icône. Il a la hauteur de la date et ouvre le suivi des fiches de
l'année.

**Sur un écran de moins de 1 024 px**, la barre n'a pas la place du
libellé : le bouton descend en tête de la page, à droite, sous le titre de
la campagne sur un téléphone.

**La page du suivi s'appelle « Suivi des évaluations »**, comme le bouton,
et le lien de retour de la fiche d'un agent aussi.

## Conséquences

- Le nombre de fiches transmises ne se lit plus sur l'accueil : il reste en
  tête de la page du suivi (« Transmises à la DCH »).
- La tuile de pilotage perd sa jauge, qui ne servait qu'au suivi.
- Trois couleurs de plus dans les jetons de l'interface, en mode clair et
  en mode sombre : le fond du bouton de la barre, son écriture, son survol.
- L'API ne change pas : l'accueil dit toujours, par `dch`, si la personne
  a l'habilitation.
