# ADR-0271 : « Remettre à zéro » : l'administration remet la fiche d'un agent à zéro

**Statut** : acceptée · 2026-11-24 · complète l'[ADR-0222](0222-administration-de-la-campagne.md) et l'[ADR-0270](0270-remise-a-zero-de-la-campagne.md)

## Contexte

L'ADR-0270 a ajouté une commande, `pnpm campagne:reinitialiser`, pour
remettre les fiches à zéro après des essais. Elle demande un terminal sur
la machine qui sert l'application. L'APIX veut le même geste dans
l'administration de la campagne.

## Décision

**Sur chaque ligne de « Qui évalue qui » dont la fiche est commencée**, un
bouton rond « Remettre à zéro » (une flèche qui tourne), à gauche du crayon
de l'évaluateur. Une fiche vierge n'en a pas. Une fiche transmise à la DCH
se remet à zéro, elle aussi.

**La fenêtre reprend celle de « Vider l'import »** (ADR-0165) : « Cette
action ne peut pas être annulée. », puis la fiche (matricule et
avancement), ce qui sera effacé selon l'avancement, ce qui reste, et le mot
EFFACER à taper. Le bouton de la fenêtre ne s'active qu'avec ce mot.

**Effacé et gardé : exactement comme la commande**, qui partage le même
SQL. Effacé : l'auto-évaluation, l'évaluation du N+1 et la partie
réservée, la validation, les commentaires du N+2, la reprise au N+2 et la
transmission à la DCH. Gardé : les objectifs de l'année, l'évaluateur de la
campagne, les dates, les comptes. Le journal d'audit garde ce que la fiche
contenait, et le compte qui l'a remise à zéro.

**L'API** : `POST /v1/campagne/administration/fiches/:employeeId/remise-a-zero`,
réservée aux comptes d'administration (403,
`campagne.administration_reservee`), sur un agent de la campagne (404,
`campagne.agent_introuvable`). Elle répond par l'administration à jour ;
une fiche déjà vierge ne change pas. La liste de l'administration donne
l'avancement de chaque fiche (`avancement`).

## Conséquences

- Une fiche remise à zéro repart de l'auto-évaluation. Si la période de
  l'auto-évaluation est passée, l'agent ne peut la refaire qu'une fois ses
  dates repoussées dans l'administration.
- Le bouton reste disponible pendant la vraie campagne. Le mot à taper et
  le journal d'audit sont les garde-fous.
- La seconde conséquence de l'ADR-0270 ne tient plus : l'administration
  rouvre une fiche validée en la remettant à zéro.
