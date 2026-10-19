# ADR-0131 : Le départ à la retraite dès 40 ans, sous CDI ou CDD ; deux retouches de la liste

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0111](0111-liste-des-documents-a-generer.md), l'[ADR-0112](0112-cinq-familles-de-documents.md) et l'[ADR-0130](0130-cible-des-documents.md)

## Contexte

L'ADR-0130 proposait l'attestation de départ à la retraite à partir de
55 ans, l'âge de la retraite anticipée de l'IPRES, à tout contrat de travail
hors stage. L'APIX veut un seuil large, pour ne manquer aucune retraite
anticipée, et seulement les contrats à durée indéterminée ou déterminée.
Dans la liste des documents, elle veut aussi voir que la cessation de
paiement relève du congé de maternité, et ranger la reprise après
disponibilité avec la disponibilité.

## Décision

**Le départ à la retraite se propose dès 40 ans, sous CDI ou CDD.** La
cible regarde le contrat qui fait foi : un CDI ou un CDD, et rien d'autre
(ni stage, ni détachement, ni dossier sans contrat). Le serveur refuse les
autres : `documents.contrat` (« ni CDI ni CDD ») ; `documents.age` dit
désormais « moins de 40 ans ».

**« Cessation de paiement et d'act. · Maternité »** remplace « Cessation de
paiement et d'activités » dans la liste, comme « Reprise de service ·
Maternité ». Le document garde son titre.

**La reprise après disponibilité passe dans « Situation administrative du
personnel »**, après la mise en disponibilité et son renouvellement.

## Conséquences

- La cible d'un document peut nommer les contrats qu'elle admet ; seule
  l'attestation de départ à la retraite le fait.
- « Générer des documents » et « Demander un document » montrent la même
  liste : le libellé et la famille changent sur les deux pages.
