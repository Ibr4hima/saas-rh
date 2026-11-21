# ADR-0050 : Sans évaluation, un certificat sans limite de validité

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0049](0049-evaluation-sans-minuterie.md)

## Contexte

L'ADR-0049 appliquait au certificat d'une formation sans évaluation la
validité réglée pour la formation. À l'échéance, rien ne permettait de le
renouveler : il n'y a pas d'évaluation à repasser.

## Décision

**Sans évaluation, le certificat n'a pas de limite de validité.** La
validité réglée ne vaut que pour le certificat d'une évaluation réussie.
L'atelier ne propose donc ses réglages, nombre de questions par tentative
et validité, qu'une fois la première question écrite.

**Seul un certificat en cours ou révoqué empêche de le délivrer.** Un
certificat d'évaluation expiré, sur une formation qui a perdu ses questions
depuis, laisse place au certificat de la formation suivie en entier. Un
certificat révoqué n'est pas redélivré.

## Conséquences

- La conséquence de l'ADR-0049 sur le renouvellement à l'échéance tombe.
- Une validité déjà réglée sur une formation sans question reste en base :
  elle vaut de nouveau dès que des questions sont ajoutées.
- Un certificat sans score obtenu avant que la formation n'ait une
  évaluation reste valable ; la page de la formation le dit « Certificat
  obtenu », et non « Évaluation réussie ».
