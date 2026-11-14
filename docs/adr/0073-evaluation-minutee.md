# ADR-0073 : Academy, l'évaluation minutée, sa durée réglée par la gestion

**Statut** : acceptée · 2026-10-14

Rétablit la minuterie que l'[ADR-0049](0049-evaluation-sans-minuterie.md)
avait retirée ; le reste de l'ADR-0049 ne change pas.

## Contexte

L'évaluation finale se composait d'abord contre la montre, deux minutes par
question, puis sans limite de temps (ADR-0049). La DCH demande qu'une
évaluation ait toujours une minuterie, et que sa durée soit choisie par qui
gère le catalogue, selon le nombre de questions : 5, 8, 10 minutes, etc.

## Décision

**Toute évaluation est minutée.** Qui gère le catalogue en règle la durée,
en minutes, dans l'atelier de la formation, à côté du nombre de questions
par tentative : de 1 à 180 minutes, l'écran proposant 5, 8, 10, 15, 20, 30,
45 et 60. Une formation existante part de l'ancienne règle, deux minutes
par question posée ; une nouvelle, de vingt minutes, pour ses dix
questions par défaut.

**Le serveur tient le temps.** Il fixe l'heure limite au début de la copie
et dit, à chaque réponse, combien de secondes restent : l'écran en part
pour son compte à rebours, sans se fier à l'heure de l'appareil, et rend la
copie de lui-même à zéro. Une copie arrivée plus de trente secondes après
l'heure limite compte pour zéro. Une copie laissée ouverte se reprend tant
que le temps court ; écoulé, elle compte comme un échec, partout où se lit
l'évaluation, suivi de l'équipe compris, et la tentative suivante la clôt
à zéro.

**L'essai de la RH est minuté de même**, sans rien enregistrer.

## Conséquences

- Quitter la page en pleine copie demande une confirmation : le temps
  continue de courir.
- L'envoi à zéro a son propre délai, posé une fois : un onglet passé en
  arrière-plan, que le navigateur ralentit jusqu'à une minute, rend sa
  copie à l'heure. Un appareil en veille à zéro, ou coupé du réseau au-delà
  de la marge, ne la rend pas : elle compte alors comme un échec.
- Une copie ouverte avant cette décision, sans heure limite, reçoit la
  sienne à la reprise : son temps part de ce moment.
- Changer la durée ne touche pas les copies déjà commencées.
- Migration 0109 : la durée de l'évaluation, par formation.
