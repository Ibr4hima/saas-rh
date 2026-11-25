# ADR-0156 : Chez le N+2, le N+1 attend l'avis ou reprend la grille

**Statut** : acceptée · 2026-10-27 · remplace en partie l'[ADR-0149](0149-evaluation-sur-la-grille-de-l-apix.md) et l'[ADR-0154](0154-le-n2-rend-la-grille-au-n1.md)

## Contexte

Jusqu'ici, une grille envoyée au N+2 pouvait partir à la DCH à tout moment :
le N+1 gardait le bouton « Envoyer à la DCH », pour que le N+2 ne bloque
jamais le circuit (ADR-0149, ADR-0154).

L'APIX ne veut pas de ce raccourci. Quand le N+1 demande l'avis du N+2, la
grille attend cet avis : l'envoyer à la DCH pendant ce temps laisserait le
N+2 avec une grille déjà partie. Mais les N+2 sont parfois trop chargés pour
répondre, et le N+1 doit pouvoir récupérer la grille.

## Décision

**Chez le N+2, la grille ne part plus à la DCH.** Le N+1 attend l'avis du
N+2 : validée par le N+2, la grille revient au N+1, qui l'envoie à la DCH
(ADR-0154). Ou le N+1 reprend la grille avec « Reprendre au N+2 », après
confirmation.

**La grille reprise revient au N+1, validée par l'agent.** Le N+1 l'envoie
alors à la DCH, ou de nouveau au N+2. Le N+2 ne peut plus l'ouvrir ; son
appel quitte sa boîte, et une notification annonce la reprise : « Awa Diop
a repris la grille d'évaluation 2026 de Moussa Ndiaye ». Le N+1 retrouve son
appel.

**Le circuit garde la trace de la reprise.** L'étape du N+2 devient
« Reprise au N+2, Mariama Cissé », avec sa date. Si la grille repart au N+2,
l'étape redevient « Chez le N+2 ».

Le N+2 ne bloque donc toujours pas le circuit : le N+1 peut reprendre la
grille à tout moment, tant que le N+2 ne l'a pas validée.

## Conséquences

- Migration 0125 : la colonne `reprise_n2_le` des grilles, le jour de la
  reprise. Aucune ligne ne change. Une grille envoyée à la DCH alors qu'elle
  était chez le N+2, avant cette décision, garde son circuit.
- Une route : `POST /evaluations/grilles/:employeeId/:annee/reprise-n2`,
  réservée au N+1 d'aujourd'hui.
- L'envoi à la DCH d'une grille chez le N+2 est refusé : « La grille est
  chez le N+2 » (`evaluations.chez_n2`).
