# ADR-0077 : Le dossier montre les résultats obtenus

**Statut** : acceptée · 2026-10-14

Précise l'[ADR-0076](0076-evaluation-annuelle.md) pour la carte
« Évaluation » du dossier que lit la DCH.

## Contexte

Sous la note et l'appréciation, la carte listait chaque objectif avec son
atteinte en toutes lettres, l'auto-évaluation de l'agent, le décompte des
atteintes et le report éventuel. Pour une lecture d'ensemble, c'était trop.

## Décision

**« Résultats obtenus ».** La section sous la note porte ce nom. Chaque
objectif y figure, avec sa case à la couleur et au signe de l'atteinte
retenue par le n+1 : coche pour atteint, tiret pour partiellement, croix pour
non atteint. Rien d'autre : ni décompte, ni auto-évaluation, ni atteinte en
toutes lettres, ni report. La note se lit avec la case de chaque objectif.

Le n+1 et l'agent gardent leur lecture de l'évaluation : l'atteinte en
toutes lettres, l'auto-évaluation, le décompte et le report (ADR-0076).

## Conséquences

- Le dossier ne reçoit plus que ce qu'il montre : pour chaque objectif, son
  texte et le résultat obtenu.
- Une évaluation validée avant la migration 0112 n'a pas d'atteinte du n+1 :
  le résultat est l'auto-évaluation de l'agent, seul noté alors.
- Un objectif reporté se retrouve dans la fiche de l'année suivante ; le
  dossier ne le signale pas.
