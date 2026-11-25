# ADR-0284 : Transmettre pour signature, à l'agent comme au N+2

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0216](0216-evaluation-par-le-n1.md), l'[ADR-0266](0266-confirmation-du-n1.md) et l'[ADR-0278](0278-envoi-simultane-a-l-agent-et-au-n2.md)

## Contexte

Le N+1 transmet son évaluation avec « Transmettre à l'agent », au bas de la
page de l'agent (ADR-0216). La fenêtre qui suit dit : « Votre évaluation
sera transmise à Awa Diop, sans la partie réservée à la hiérarchie. Elle ne
pourra plus être modifiée. » (ADR-0266). Dessous, la case « Envoyer aussi
la fiche au N+2, Cheikh Mbaye », puis : « Après la transmission, la fiche
ne pourra plus être envoyée au N+2. » (ADR-0278). L'APIX précise que la
fiche part pour signature, et retire cette dernière phrase.

## Décision

Le bouton devient « Transmettre pour signature ». « Valider » reste à sa
gauche.

La fenêtre dit : « Votre évaluation sera transmise à Awa Diop, sans la
partie réservée à la hiérarchie **pour signature**. Elle ne pourra plus être
modifiée. » Le nom de l'agent et « pour signature » sont en gras.

La case dit : « Envoyer aussi la fiche au N+2, Cheikh Mbaye pour
signature ». Rien ne la suit.

## Conséquences

- La règle de l'ADR-0278 ne change pas : la fiche part au N+2 au moment de
  la transmission, ou jamais. La fenêtre ne le rappelle plus.
- Pour l'agent comme pour le N+2, la signature est la validation en ligne
  (ADR-0209) : l'agent valide son évaluation, le N+2 transmet ses
  commentaires.
- La campagne des objectifs garde « Transmettre à l'agent » (ADR-0274) :
  l'agent y lit ses objectifs, sans les signer.
