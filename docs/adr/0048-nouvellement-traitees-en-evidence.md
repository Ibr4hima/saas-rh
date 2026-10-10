# ADR-0048 : Arrivé par l'avis, les demandes nouvellement traitées en évidence

**Statut** : acceptée · 2026-10-09 · précise l'[ADR-0043](0043-suivi-en-cours-puis-traitees.md)

## Contexte

L'avis d'une demande traitée menait au suivi, où « Demandes traitées » était
pliée : il fallait la déplier, puis y retrouver, parmi les anciennes, la
demande que l'avis annonçait.

## Décision

**L'avis d'une demande traitée la désigne.** Prête, corrigée ou refusée, son
lien est `/moi/documents/suivi?traitee=<id>`, en ligne comme dans le
courriel. L'avis d'une mise en traitement mène au suivi comme avant.

**Arrivé par cet avis, « Demandes traitées » s'ouvre sur les seules demandes
nouvellement traitées.** Une demande est nouvellement traitée tant que l'avis
qui l'annonce n'est pas lu ; celle que l'avis désigne l'est toujours. Elles
viennent en tête, teintées du bleu de la marque, bordées d'un filet et
marquées « Nouveau » ; à l'arrivée, elles s'éclairent un instant. Dessous, un
bouton affiche les autres demandes traitées, s'il y en a.

**Vues, leurs avis passent pour lus**, dans la cloche aussi
(`POST /v1/document-requests/vues`). Elles restent en évidence jusqu'à ce
qu'on quitte la page ; recharger celle-ci ne rejoue pas l'arrivée.

## Conséquences

- Aucune colonne nouvelle : l'état « lu » de l'avis tient lieu de « vu ».
  Une demande lue dans la cloche n'est donc plus nouvelle ; un nouvel avis
  sur la même demande (point de retrait corrigé, document déposé) la rend de
  nouveau nouvelle.
- La conséquence de l'ADR-0043 sur l'avis qui mène à la carte pliée tombe
  pour les demandes traitées.
- Les avis envoyés avant gardent leur lien : ils ouvrent le suivi comme avant.
- Venu par le menu, le suivi ne change pas : « Demandes traitées » reste pliée.
