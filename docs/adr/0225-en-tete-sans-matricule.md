# ADR-0225 : L'en-tête et les cartes des agents sans le matricule

**Statut** : acceptée · 2026-11-21 · révise l'[ADR-0211](0211-mode-campagne-et-accueil.md)

## Contexte

Sous le nom d'un agent, l'en-tête de la campagne donnait le matricule, puis
le poste ; les cartes des agents de l'accueil, le poste, puis le matricule
(ADR-0211). L'APIX ne veut que le poste.

## Décision

**Sous le nom, le poste seul**, sans le matricule :

- dans l'en-tête d'un agent, partout où il paraît : l'accueil, la page du
  N+1, celle du N+2, la fiche lue par la DCH ;
- sur les cartes des agents de l'accueil, « Mon équipe » et
  « Commentaires du N+2 ». Le poste y tient sur deux lignes au plus, au
  lieu d'une seule.

## Conséquences

- Le suivi de la DCH et l'administration gardent le matricule, qui y
  distingue deux agents du même nom et sert à la recherche.
