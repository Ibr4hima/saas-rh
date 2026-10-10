# ADR-0052 : Objectifs d'un direct, une année à la fois

**Statut** : acceptée · 2026-10-10

## Contexte

Sur la page d'un direct, toutes les années d'objectifs s'empilaient, la plus
récente d'abord, et « Fixer des objectifs » ne valait que pour l'année en
cours : les objectifs de l'année suivante ne pouvaient pas se préparer avant
le 1er janvier.

## Décision

**Une année à la fois.** Le titre « ANNÉE 2026 » devient une liste
déroulante. Elle propose toujours l'année suivante, puis l'année en cours,
puis les années passées qui ont des fiches, la plus récente d'abord. L'année
en cours s'affiche par défaut : en 2027, c'est 2027, et la liste propose 2028.

**Les objectifs se fixent pour l'année en cours, ou à l'avance pour la
suivante.** « Fixer des objectifs » ne paraît que pour ces deux années. Les
années passées gardent leurs fiches, modifiables tant que l'agent n'a pas
envoyé son auto-évaluation.

**La vue Évaluation suit l'année choisie.** Sans choix, elle s'ouvre sur
l'année d'une auto-évaluation qui attend le n+1, et l'avis « a envoyé son
auto-évaluation » porte l'année de la fiche dans son lien. Dans la liste,
une pastille orange marque les années où une auto-évaluation attend.

**L'adresse garde l'année** (`?annee=2025`) : recharger la page ou suivre le
lien la rouvre sur la même année.

## Conséquences

- « Mes objectifs », la page de l'agent, garde ses années empilées : une
  fiche fixée à l'avance y paraît sous « ANNÉE 2027 », et l'agent en est
  prévenu comme d'une autre.
- Les avis d'auto-évaluation envoyés avant ce changement n'ont pas l'année
  dans leur lien : la page s'ouvre alors sur l'année d'une auto-évaluation
  qui attend.
- Pour un agent qui a quitté l'APIX, la liste ne propose pas l'année
  suivante.
