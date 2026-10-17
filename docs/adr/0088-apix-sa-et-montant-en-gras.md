# ADR-0088 : Les attestations : « APIX-SA » partout, le montant en gras

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0087](0087-attestation-de-revenu.md)

## Contexte

Les deux modèles de l'APIX n'écrivent pas la société de la même façon :
« APIX-SA » dans l'attestation de travail, « APIX-S.A. » dans l'attestation
de revenu. Le montant de l'attestation de revenu n'était pas en gras, quand
les noms et la date d'entrée le sont (ADR-0087).

## Décision

**Les attestations écrivent « APIX-SA »**, la forme de l'attestation de
travail, quel que soit le modèle. Le sigle se tient en un seul endroit
(`ENTETE.sigle`), que chaque modèle reprend.

**Le montant est en gras** : les chiffres, les lettres entre parenthèses et
« francs CFA », comme les noms et la date d'entrée.

## Conséquences

- Un modèle à venir écrit la société « APIX-SA », quoi que porte son
  original.
- La raison sociale « APIX S.A » ne change pas là où elle figure : le titre
  du site, le pied des courriels, les certificats d'APIX Academy, les offres
  d'emploi et les propriétés des PDF.
