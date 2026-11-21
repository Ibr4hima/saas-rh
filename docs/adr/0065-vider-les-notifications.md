# ADR-0065 : Vider la boîte et les archives des notifications

**Statut** : acceptée · 2026-10-12

## Contexte

Le panneau des notifications a deux vues : la boîte et les archives
(migration 0021). Ranger une notification la garde, et rien ne
s'effaçait : les archives ne faisaient que grossir, et « Tout archiver »
ne vidait la boîte qu'en remplissant les archives. Les agents veulent
vider l'une et l'autre.

## Décision

**« Vider la boîte » et « Vider les archives »**, au pied du panneau,
effacent toute la vue affichée, lues comme non lues, dans la boîte de
l'espace où l'on est : vider sa boîte de Gestion RH ne touche pas à Mon
espace. Le pied ne paraît que si la vue a quelque chose à effacer.

**Effacer ne se rattrape pas** : le premier clic demande « Effacer
définitivement ? » dans le pied même, avec « Annuler » et « Vider ». Pas de
fenêtre de plus, posée sur un panneau déjà ouvert. Au clavier, le focus va
à « Annuler », puis revient au bouton qui a demandé la confirmation.

**La ligne reste dans la table, marquée effacée** (`effacee_le`,
migration 0106). Elle ne se montre plus nulle part, et son courriel ou son
message WhatsApp, s'il attend encore, ne part pas. Sa clé (`dedupe_key`)
reste prise, comme celle d'une notification remplacée : un rappel généré
(férié, échéance de contrat, pièce qui expire) ne revient pas à la
prochaine ouverture du panneau. Supprimer la ligne l'aurait fait revenir.

**« Tout archiver » reste dans l'en-tête** : ranger garde, vider efface.

**Le compte des archives est gris** : rien n'y attend. Celui de la boîte,
les non-lues, reste rouge, comme la pastille de la cloche.

## Conséquences

- Une notification effacée ne se ressort pas des archives et ne se range
  plus : pour la personne qui l'a reçue, elle n'existe plus.
- Le texte reste en base, comme celui d'une notification remplacée, et le
  journal d'audit trace l'effacement.
- Le suivi des demandes de documents ne met plus en avant une demande
  traitée dont l'avis a été effacé, comme pour un avis rangé.
