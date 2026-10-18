# ADR-0099 : Le NINEA de l'APIX est 28409592G3, partout

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0098](0098-contrats-de-travail.md)

## Contexte

Le modèle des contrats de travail donnait au NINEA de l'APIX la valeur
« 28409592A3 », le pied de page de ses documents « 28409592G3 ». L'ADR-0098
avait repris le texte du contrat tel quel, en attendant confirmation. La DCH
a confirmé : le bon NINEA est « 28409592G3 ».

## Décision

**Le NINEA est « 28409592G3 », et il n'est écrit qu'une fois** : dans
l'identité de l'APIX (`ENTETE.ninea`, `documents/entete.ts`), d'où le pied
de page et les contrats de travail le tirent. Le « 28409592A3 » du modèle
était une coquille (ADR-0095).

## Conséquences

- Un changement de NINEA se fait à un seul endroit.
