# ADR-0151 : Les paraphes des signataires de la grille, et ses deux notes au dossier de l'agent

**Statut** : acceptée · 2026-10-26 · remplace en partie l'ADR-0149

## Contexte

La grille d'évaluation se remplit, se valide et circule dans l'application
(ADR-0149) : le N+1 l'envoie à l'agent, l'agent la valide, le N+2 la
commente et la valide. Son PDF imprimait les noms et les dates, mais laissait
les lignes de signature à signer à la main, alors que personne n'imprime plus
la grille pour la signer.

Avant la grille, la note de l'évaluation annuelle allait au dossier de
l'agent. La grille en donne deux, dans la synthèse du N+1 : la compréhension
et la tenue du poste, chacune de A à D.

## Décision

**Qui valide paraphe.** Sur le PDF, la ligne de signature de chaque personne
qui a validé la grille dans l'application porte son paraphe : les initiales
de chacun de ses prénoms et de son nom (« M.C. », « C.T.M. », « J.-P.D. »),
dans une écriture manuscrite, en noir et en gras, un peu penchées.

| Qui     | Où                                             | Quand                           |
| ------- | ---------------------------------------------- | ------------------------------- |
| Le N+1  | La ratification ; « Signature de N+1 », page 6 | En envoyant la grille à l'agent |
| L'agent | La ratification                                | En validant la grille           |
| Le N+2  | Le cadre de ses commentaires, page 6           | En validant la grille           |

Une ligne dont la personne n'a pas validé garde ses pointillés, comme celles
des autres hiérarchies, qui restent à remplir à la main.

**L'écriture.** Allura, sous licence OFL, versionnée avec les autres polices
des PDF. Elle n'a qu'une graisse : son contour, tracé à la même encre,
l'épaissit.

**Les deux notes au dossier.** La carte « Évaluations annuelles » de la fiche
de l'agent montre, pour chaque grille transmise à la DCH, la compréhension et
la tenue du poste : ce que chaque note veut dire (« Connaît parfaitement le
poste de travail »), sans sa lettre ni sa couleur. La carte reste à qui suit
l'évaluation à la DCH ; l'agent ne lit jamais la page 6, ni ces notes.

## Conséquences

- Le paraphe dit qu'une validation a été faite dans l'application, par le
  compte de la personne, à la date imprimée, et le journal d'audit en garde
  la trace. Ce n'est pas une signature électronique qualifiée.
- La colonne « Grille » (cadre ou non cadre) de la carte laisse sa place aux
  deux notes ; le PDF le dit toujours.
