# ADR-0026 : La fiche d'objectifs en trois parties

**Statut** : acceptée · 2026-10-07

## Contexte

La fiche d'objectifs d'un semestre était une page libre : titres, puces,
citations, tableaux, gras, échéances datées et blocs « Formation » s'y
mêlaient aux cases à cocher. Le n+1 y écrivait des objectifs sans case, et
l'agent ne savait plus ce qui comptait pour son évaluation.

## Décision

**Trois parties, dans cet ordre.**

1. **Les objectifs** : des cases à cocher, en texte simple, sans gras, ni
   italique, ni puce, ni lien. Il reste toujours une case : la première ne
   s'efface pas. Le clavier suit : Entrée sur une case vide n'en ouvre pas
   d'autre, Retour arrière en tête de case la fond dans celle du dessus,
   Tab ne range pas une case sous une autre, un collage devient des cases.
2. **Les formations à suivre** : le catalogue publié de l'APIX Academy.
   Celles que l'agent a terminées ou certifiées ne se cochent pas ; cocher
   une autre la lui demande. Elle s'évalue comme un objectif, comme le
   faisait le bloc « Formation ».
3. **Les commentaires** : un texte libre du n+1 sur les objectifs fixés,
   mis en forme à volonté, sans case à cocher.

**Un seul contenu.** Les trois parties restent dans `objectifs_fiches.contenu`,
dans l'ordre : les cases, puis les blocs `formation`, puis les blocs du
commentaire. Le type d'un bloc dit sa partie. Rien ne change en base ni dans
l'API : l'extraction des objectifs (cases et formations), les statuts, les
verrous et l'évaluation lisent le contenu comme avant.

**L'échéance est retirée** pour l'instant. Une échéance déjà posée se lit en
texte (« 15 déc. 2026 »).

## Conséquences

- Une fiche rédigée avant ce partage se range à l'ouverture : ses cases
  deviennent les objectifs (texte simple), ses formations les formations à
  suivre, ses paragraphes, puces et titres le commentaire. Elle s'enregistre
  rangée à la prochaine modification du n+1.
- Une échéance devenue texte change l'empreinte de son objectif : si l'agent
  lui avait déjà donné un statut, et que le n+1 modifie la fiche avant
  l'envoi de l'auto-évaluation, ce statut est à redonner.
- La règle est tenue par l'éditeur ; le serveur garde le contenu tel qu'il le
  reçoit.
