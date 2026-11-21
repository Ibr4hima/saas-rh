# ADR-0042 : Demandes de documents : ce qui s'efface, ce qui se consulte

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0012](0012-arbitrages-direction-capital-humain.md) (décision 2) et l'[ADR-0040](0040-document-remis-en-ligne.md)

## Contexte

Le suivi des demandes de documents s'allongeait de lignes sans usage : des
demandes annulées, et la même attestation demandée cinq fois, prête cinq
fois. L'ancienneté (« Prête il y a 21 jours ») et la colonne « Remise »
encombraient la lecture ; un document déposé en ligne s'enregistrait au
clic, sans pouvoir le lire d'abord.

## Décision

**Une demande annulée s'efface**, avec ses avis et ses documents déposés.
Elle n'apparaît plus nulle part ; qui la préparait est prévenu de
l'annulation.

**Une demande identique remplace l'ancienne.** À la création, les demandes
closes (prêtes, remises, refusées) du même agent pour le même document
s'effacent : même type de document, mêmes mois de bulletin. « Les N
derniers mois » se comptent du mois de la demande : deux demandes des
« 3 derniers mois » ne sont identiques que faites le même mois. Un bulletin
d'octobre et novembre ne remplace pas celui de juillet à septembre. Une
demande en cours ne s'efface jamais, et empêche déjà d'en refaire une
identique. La migration 0101 applique la même règle à l'existant : elle est
destructive (`MIGRATIONS_DESTRUCTIVES`, après sauvegarde).

**Le suivi de l'agent se lit en quatre colonnes** : Document, Demandée le,
Statut, État traitement. Plus d'ancienneté (« Déposé aujourd'hui », « Prête
il y a… »). L'état du traitement dit, une fois la demande prête, auprès de
qui retirer le document, ou propose « Consulter ».

**« Consulter » ouvre le document déposé** dans la fenêtre d'aperçu de
l'application ; plusieurs documents se parcourent un à un, et chacun se
télécharge.

## Conséquences

- L'ADR-0012 (révision du 2026-08-20) montrait l'ancienneté des deux côtés :
  elle ne l'est plus côté agent.
- L'historique de la DCH perd les demandes effacées : la durée de traitement
  d'une demande remplacée ne se relit plus.
- Le statut « annulée » ne se pose plus ; il reste défini pour la lecture.
- Le journal d'audit garde la trace de chaque effacement.
