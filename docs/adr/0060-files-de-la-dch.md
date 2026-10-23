# ADR-0060 : Files de la DCH : sa propre demande sans geste, chacun ce qui lui est délégué

**Statut** : acceptée · 2026-10-12

## Contexte

Qui dirige la DCH a demandé une attestation de travail. Personne n'ayant la
délégation des attestations, la demande attendait d'être confiée : la file
des documents disait « Votre propre demande, à déléguer à un membre de la
DCH », et la demande s'y cochait comme une autre.

Un membre de la DCH à qui l'on n'avait délégué que les certificats de travail
voyait toute la file des documents, attestations comprises : la demande de
qui dirige la DCH y figurait, avec la même phrase, « Votre propre demande »,
alors que ce n'était pas la sienne. La délégation d'un type de document
ouvrait la file de tous les types ; seules les pièces se voyaient déjà type
par type.

## Décision

**« Déléguer à un membre de la DCH »** remplace « Votre propre demande, à
déléguer à un membre de la DCH » (demandes de documents, mises à jour
d'informations, vérification des documents). La phrase ne s'affiche qu'à qui
a fait la demande : l'API ne dit `aConfier` qu'à l'appelant dont c'est la
demande.

**Sa propre demande ne se coche pas** dans l'espace de la DCH, pour aucun de
ses membres : seules se cochent les demandes qu'on peut traiter
(`canAdvance`), et « Tout sélectionner » ne prend qu'elles. Personne ne
traite sa propre demande, le serveur le refusait déjà ; l'agent l'annule
depuis son espace personnel. Au calendrier des absences de la DCH, son propre
congé se lit sans geste : ni Annuler, ni Rappeler.

**Un membre ne voit dans la file des documents que ce qui lui est délégué** :
les types qui lui sont délégués, et une demande qu'on lui a confiée, tant
qu'elle est ouverte. Ni une demande d'un autre type, ni la sienne d'un autre
type : chacun suit ses demandes dans son espace personnel. Qui dirige la DCH
voit toute la file ; l'administrateur la lit, sans la traiter.

**Une demande prête se corrige par qui traite son type** : son point de
retrait et ses documents remis, par qui dirige la DCH ou le membre à qui ce
type est délégué. Plus au titre d'un autre type, ni par l'administrateur.

## Conséquences

- La file des documents se lit comme celle des pièces : type par type. Les
  congés et les mises à jour d'informations, délégués d'un bloc, ne changent
  pas.
- `GET /document-requests` sans `scope=mine` est la file de la DCH : un agent
  n'y trouve plus ses propres demandes, qu'il lit avec `scope=mine`.
- Une délégation retirée retire de la file les demandes de ce type, traitées
  comprises.
