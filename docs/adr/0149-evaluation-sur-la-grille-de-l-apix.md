# ADR-0149 : L'évaluation annuelle sur la grille de l'APIX, sans objectifs fixés dans l'application

**Statut** : acceptée · 2026-10-26 · remplace les ADR-0026, 0027, 0051, 0052,
0054, 0057, 0058, 0075, 0076, 0077, 0078 et 0079

## Contexte

À l'APIX, les objectifs se donnent surtout de vive voix ou par d'autres
canaux, et changent souvent en cours d'année. Une fiche d'objectifs tenue
dans l'application, cochée au fil des mois puis auto-évaluée, ne correspond
pas à cette pratique.

L'évaluation, elle, se fait chaque année sur une grille de la DCH : la
« Grille d'évaluation du personnel cadre » (réf. S1/EN02), et une grille pour
le personnel non cadre. Elle rappelle les objectifs de l'année écoulée, note
treize critères de A à D, résume les points forts et les points faibles, fixe
les objectifs à venir, et se ratifie par l'agent.

## Décision

**Plus d'objectifs dans l'application.** « Mes objectifs », « Objectifs de
l'APIX », la fiche d'objectifs du N+1, les cases cochées, l'auto-évaluation,
le report et la note de A à D disparaissent, avec leurs avis.

**La DCH ouvre la période d'évaluation.** Qui dirige la DCH fixe, pour chaque
année, la période d'évaluation : du … au …. Le N+1 remplit les grilles à
partir de la date d'ouverture. Après la date de fin, une grille non terminée
reste ouverte et apparaît en retard dans le suivi de la DCH.

**La grille suit l'agent.** La fiche de l'agent dit « cadre » ou « non
cadre » ; la grille correspondante s'ouvre d'elle-même. La grille du
personnel non cadre viendra avec son modèle.

**Le circuit.**

1. Le N+1 remplit ses parties : l'identification, préremplie depuis le
   dossier ; le rappel des objectifs de l'année écoulée, repris des objectifs
   à venir de la grille précédente ; les treize critères, dont le
   « Commandement », qui ne vaut que pour un agent qui encadre ; le résumé, les
   actions, les objectifs à venir, les besoins de formation, la synthèse et
   ses observations. Le N+1 envoie la grille à l'agent.
2. L'agent lit les pages 1 à 5, jamais la page 6, réservée à la hiérarchie.
   L'agent valide, avec des commentaires au besoin : c'est la ratification
   que la grille rend obligatoire. En désaccord, l'agent peut aussi renvoyer
   la grille au N+1 avec un mot ; le N+1 la corrige et la renvoie.
3. Une fois la grille validée par l'agent, le N+1 l'envoie à la DCH, ou
   d'abord au N+2. Le N+2 commente et valide, ce qui l'envoie à la DCH. Sans
   réaction du N+2, le N+1 peut l'envoyer à la DCH à tout moment : le N+2 ne
   bloque jamais le circuit.
4. Terminée, la grille donne un PDF de six pages, fidèle au modèle de
   l'APIX : l'original au dossier de l'agent, pour la DCH ; les copies pour
   le N+1, et pour le N+2 qui a reçu la grille.

**Qui la lit à la DCH.** Le suivi des grilles et leurs PDF sont à qui a
l'habilitation « Tableau de bord », celle de l'écran « Évaluation annuelle ».
Consulter les dossiers du personnel n'y suffit pas : une grille ne se lit pas
comme une adresse.

**Le PDF.** La mise en page du modèle, ordonnée (marges, cadres et polices
harmonisés), et son texte corrigé de ses fautes. Les noms et les dates
s'impriment ; les lignes de signature restent à signer à la main, comme les
commentaires des autres hiérarchies. Gill Sans MT ne se versionne pas : Cabin
la remplace tant que l'exploitant n'a pas déposé la vraie (ADR-0090).

## Conséquences

- Migration 0123 : la colonne `personnel` des agents (cadre ou non cadre), la
  période de chaque année (`evaluation_periodes`), les grilles
  (`evaluation_grilles`). Les tables des objectifs restent en base,
  inutilisées, jusqu'à une migration qui se déclarera destructive (ADR-0010) ;
  leurs avis et leurs appels quittent les boîtes.
- Les sujets de notification des objectifs deviennent « Mon évaluation
  annuelle » et « Évaluations de mon équipe » ; les réglages déjà faits
  suivent.
- L'éditeur de texte des fiches d'objectifs (BlockNote) quitte le site.
- Les formations données à suivre depuis la fiche disparaissent : les besoins
  de formation s'écrivent dans la grille. L'Academy reste en libre accès.
- Menus : « Mon évaluation » dans l'espace de l'agent, « Évaluations » dans
  « Mon équipe », « Évaluation annuelle » du côté de la DCH.
