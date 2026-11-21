# ADR-0209 : Les paraphes sur la fiche d'entretien, et les lignes de la section 8.4

**Statut** : acceptée · 2026-11-20 · révise l'[ADR-0205](0205-fiche-d-entretien-annuel.md)
et l'[ADR-0208](0208-fiche-d-entretien-vierge.md)

## Contexte

L'ADR-0205 avait écarté de la fiche les paraphes de l'ADR-0151 : une écriture
qui imite des initiales pouvait se confondre avec une vraie signature. La DCH
veut les retrouver sur la fiche, comme sur l'ancienne grille.

## Décision

**Qui valide en ligne paraphe.** Le paraphe est celui de la grille
(ADR-0151) : les initiales de chaque prénom et du nom (« M.S.F. »), en Allura,
en noir, un peu penché.

| Qui     | Où                                                                       | Quand                      |
| ------- | ------------------------------------------------------------------------ | -------------------------- |
| L'agent | Section 7, colonne « Signature »                                         | En validant la fiche       |
| Le N+1  | Section 7, colonne « Signature » ; au bout de sa ligne de signature, 8.2 | En validant son évaluation |
| Le N+2  | Au bout de sa ligne de signature, 8.3                                    | En validant la fiche       |

La mention reste : « Validation en ligne » en petit sous le paraphe de la
section 7, « Validation en ligne le 22 décembre 2026 » sur les lignes de
signature. Sans validation, pas de paraphe : la place de signer à la main
reste. La fiche vierge n'en porte aucun.

**Les lignes de la section 8.4.** Elles prennent la place qui reste sur la
dernière page, de trois à six, la diffusion dessous. S'il en tient moins de
trois, la section passe à la page suivante avec quatre lignes.

## Conséquences

- Comme sur la grille, le paraphe dit qu'une validation a été faite dans le
  portail, par le compte de la personne, à la date imprimée. Ce n'est pas une
  signature électronique qualifiée.
- Le paraphe prend 76 points au bout des lignes de signature des sections 8.2
  et 8.3 : la mention de la validation y passe plus souvent à la ligne.
- Les PDF des fiches validées embarquent Allura, déjà livrée avec les autres
  polices des documents.
