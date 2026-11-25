# ADR-0264 : Sous « Département » et « Service », le nom de l'unité sans ce mot

**Statut** : acceptée · 2026-11-22 · complète l'[ADR-0224](0224-en-tete-de-l-agent.md)

## Contexte

En tête de la fiche d'un agent, les repères donnent sa direction, son
département et son service (ADR-0224). Les unités portent leur type dans
leur nom : sous l'intitulé « Département », on lisait « Département
Développement du personnel ». L'APIX ne veut pas de cette répétition.

## Décision

**Sous « Département » et sous « Service », le nom de l'unité perd ce mot
en tête**, et l'article qui le suit s'il y en a un : « Département
Développement du personnel » se lit « Développement du personnel » ;
« Département des Études économiques », « Études économiques » ; « Service
de la paie », « Paie ». La première lettre restante prend une capitale. Un
nom réduit au seul mot « Département » ou « Service » reste tel quel.

La direction garde son nom : retirer « Direction » laisserait des noms
incomplets (« Générale »).

## Conséquences

- Vaut partout où les repères de l'agent s'affichent : son accueil, sa
  fiche chez le N+1, le N+2 et la DCH.
- Les noms des unités ne changent pas dans la base, ni dans le PDF de la
  fiche, qui suit le modèle S1/EN05.
