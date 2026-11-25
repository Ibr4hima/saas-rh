# ADR-0155 : La grille du personnel non cadre

**Statut** : acceptée · 2026-10-26 · complète l'[ADR-0149](0149-evaluation-sur-la-grille-de-l-apix.md)

## Contexte

L'ADR-0149 a mis en place l'évaluation annuelle sur la grille du personnel
cadre (réf. S1/EN02) et laissé la grille du personnel non cadre pour plus
tard. La DCH en a fourni le modèle : la « Grille d'évaluation du personnel
non cadre » (réf. S1/EN03, version 01, du 25/12/2014), en cinq pages.

Cette grille ne ressemble pas tout à fait à l'autre :

- elle n'a ni rappel des objectifs de l'année écoulée, ni objectifs à venir ;
- ses huit critères se notent de 10 à 0, avec deux notes par niveau : 10 ou
  9 pour A, 7 ou 6 pour B, 4 ou 3 pour C, 1 ou 0 pour D ;
- un relevé des notes pondère chaque note par un coefficient et donne un
  total sur 170 ;
- ses couleurs ne sont pas celles de la grille du personnel cadre : des
  bandes d'un bleu-gris clair et du texte noir, là où l'autre a des bandes
  marine et du texte blanc.

## Décision

**La grille suit la fiche de l'agent.** « Non cadre » sur la fiche ouvre
cette grille, avec le même circuit que l'autre : le N+1 la remplit et
l'envoie à l'agent, qui la valide ou la renvoie ; le N+2 si le N+1 le
souhaite ; la DCH à la fin (ADR-0154).

**Huit critères, chacun avec son coefficient**, dans l'ordre du modèle :

| N°  | Critère                                          | Coefficient |
| --- | ------------------------------------------------ | ----------- |
| 1   | Connaissances techniques et expérience pratique  | 2           |
| 2   | Qualité du travail fourni                        | 3           |
| 3   | Capacité de travail                              | 3           |
| 4   | Sens de l'initiative                             | 2           |
| 5   | Relations humaines                               | 1           |
| 6   | Esprit d'équipe et de collaboration              | 1           |
| 7   | Ponctualité, absentéisme, assiduité              | 2           |
| 8   | Discipline (par rapport aux consignes et ordres) | 3           |

Les coefficients font 17 : un agent noté 10 partout obtient 170.

**À l'écran.** Le N+1 donne une note par critère : chaque niveau affiche ce
qu'il veut dire et ses deux notes, et prend sa couleur quand l'une d'elles
est choisie. Le relevé des notes se met à jour à chaque note : note brute,
coefficient, note pondérée, et le total sur 170 dès que les huit critères
sont notés. La grille peut partir à l'agent quand les huit notes, les points
forts, les points faibles et la synthèse du N+1 sont remplis.

**Le PDF reprend les cinq pages du modèle, avec ses couleurs** : la
couverture et l'identification ; les huit critères, avec les deux cases de
chaque niveau, une croix dans celle de la note donnée ; le relevé des notes,
le résumé et les actions ; la formation et la ratification ; la partie
réservée à la hiérarchie. Comme dans la grille du personnel cadre,
« Contenu et justification » n'apparaît plus sous les actions (ADR-0150).

**Le texte du modèle est corrigé** :

- « Prend » au lieu de « Prends » (critère 4), « maîtrise », « maîtriser »,
  les majuscules en milieu de phrase (« Ses collègues », « Strict
  nécessaire », « Des conflits », « Problèmes »), la ponctuation ;
- critère 3, niveau C : « Quantité de travail parfois en dessous des
  exigences ». Le modèle écrit « Qualité », mais ce critère porte sur le
  rythme et la quantité de travail, et le niveau D parle de quantité ;
- critère 3, niveau D : « Quantité de travail et de production
  insuffisante » ;
- « il maîtrise » et « il rejette » deviennent « maîtrise » et « rejette »,
  comme dans la grille du personnel cadre ;
- la note « (\*) Utiliser ce critère uniquement pour les agents ayant des
  collaborateurs sous leurs ordres » n'est pas reprise : elle vient de la
  grille du personnel cadre, et aucun critère de cette grille n'y renvoie.

**Tant que la grille est chez le N+1, elle suit la fiche.** Si la DCH
corrige « cadre » ou « non cadre » sur la fiche avant l'envoi à l'agent, la
grille passe au bon modèle : le résumé, les actions, les besoins de formation
et la synthèse sont conservés, le reste est à remplir. Une fois envoyée à
l'agent, la grille garde son modèle.

## Conséquences

- Pas de migration : la colonne `modele` des grilles accepte déjà
  `non_cadre`, et les notes s'ajoutent au contenu de la grille (`notes`, une
  par critère).
- Les deux grilles partagent la même mise en page pour l'en-tête, la
  couverture, la formation, la ratification et la partie réservée à la
  hiérarchie ; chaque modèle apporte ses propres pages et ses couleurs. Le
  PDF de la grille du personnel cadre ne change pas.
- Au dossier de l'agent, une grille du personnel non cadre donne les deux
  mêmes notes de synthèse que l'autre (ADR-0151).
- Les titres du modèle sont en Trebuchet MS, une police de Microsoft qui ne
  peut pas être ajoutée au dépôt : le PDF utilise Cabin, comme pour Gill
  Sans MT dans la grille du personnel cadre (ADR-0149).
