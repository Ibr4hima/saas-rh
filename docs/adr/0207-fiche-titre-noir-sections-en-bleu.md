# ADR-0207 : La fiche d'entretien, son titre en noir, ses numéros de section en bleu, sans barres en pied

**Statut** : acceptée · 2026-11-18 · révise l'[ADR-0206](0206-fiche-a-l-en-tete-du-modele.md)
pour trois touches de couleur

## Contexte

La DCH valide la mise en page de l'ADR-0206 et y apporte trois retouches.

## Décision

| Où                                   | Avant                        | Désormais                  |
| ------------------------------------ | ---------------------------- | -------------------------- |
| Le titre de la fiche, dans l'en-tête | En bleu                      | En noir                    |
| Le numéro d'une section (1, 2, 3…)   | En blanc sur un carré orange | En blanc sur un carré bleu |
| Le pied de page                      | Deux barres, bleue et orange | Les mentions seules        |

Le numéro d'une sous-section (2.1, 2.2.1…) et les étiquettes comme
« OBJECTIF 1 » restent en orange.

Au passage, la ligne de signature des sections 8.2 et 8.3 ne coupe plus
« Validation en ligne le 28 décembre 2026 » en fin de ligne : quand tout ne
tient pas sur une ligne, la mention passe entière sous le nom.

## Conséquences

- La fiche n'emploie plus l'orange de la charte en aplat : seulement celui
  des petits textes (#B14600), plus soutenu.
- Le reste de l'ADR-0206 tient : l'en-tête du modèle, les touches de bleu,
  l'air, la seule colonne, la grille des compétences à l'italienne.
