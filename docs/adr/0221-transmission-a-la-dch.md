# ADR-0221 : La transmission de la fiche à la DCH par le N+1, et le suivi de la DCH

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0218](0218-commentaires-du-n2.md)

## Contexte

Sur la plateforme de base, la grille validée par l'agent part à la DCH par
le N+1, après l'avis du N+2 s'il y en a un (ADR-0149, ADR-0154). Le N+1
reprend la grille au N+2 qui tarde (ADR-0156). La DCH suit les grilles et
lit leurs PDF avec l'habilitation « Tableau de bord ». La campagne
s'arrêtait aux commentaires du N+2 (ADR-0218).

## Décision

**Le N+1 transmet la fiche à la DCH**, une fois validée par l'agent et les
commentaires du N+2 reçus ; sans N+2, dès la validation. Sur la page de
l'agent, une quatrième étape, « Transmission à la DCH » : « À transmettre »,
puis « Transmise le … ». La barre du bas porte « Transmettre à la DCH »,
avec à gauche la dernière étape franchie et son jour. La confirmation
reprend le texte de la plateforme de base : « La fiche d'évaluation 2026 de
Moussa Ndiaye sera transmise à la DCH. Elle ne pourra plus être modifiée. »
Sur la carte de l'équipe : « À transmettre à la DCH » en orange, puis
« Transmise à la DCH » en vert.

**Chez le N+2, le N+1 reprend la fiche s'il le faut**, comme sur la
plateforme de base : « Reprendre au N+2 », après confirmation (« Mariama
Cissé ne pourra plus la commenter. Vous pourrez ensuite la transmettre à la
DCH. »). Reprise, la fiche ne s'ouvre plus au N+2, et sa carte dit
« Reprise par le N+1 ». Le N+1 la transmet, ou la renvoie au N+2 avec
« Renvoyer au N+2 » : le N+2 retrouve son brouillon.

**La DCH suit toutes les fiches de l'année**, sur la page « Suivi de la
DCH » (`/evaluation-annuelle/dch`), avec l'habilitation « Tableau de
bord », comme l'écran « Évaluation annuelle » de la plateforme. En tête,
quatre nombres : les agents à évaluer, les auto-évaluations faites, les
fiches validées par l'agent, les fiches transmises. Dessous, chaque agent
par ordre alphabétique, avec sa direction, son N+1, l'étape de sa fiche et
le jour de sa transmission. Les étapes : auto-évaluation non commencée, en
cours, chez le N+1, chez l'agent, chez le N+2, à transmettre par le N+1,
transmise à la DCH. On cherche un agent par son nom ou son matricule, et on
filtre par étape.

Sur l'accueil, une carte « Suivi de la DCH » ouvre la page, avec le nombre
de fiches transmises. Un compte d'administration, sans dossier d'agent, ne
voit que cette carte.

**La DCH lit la fiche transmise en entier** (`/evaluation-annuelle/dch/{agent}`) :
ses étapes, avec leur jour et leur auteur, puis la fiche S1/EN05, partie
réservée et commentaires du N+2 compris. « Télécharger le PDF » donne la
fiche complète (`fiche-entretien-2026-{matricule}-complete.pdf`), avec les
validations en ligne du N+1, de l'agent et du N+2. Avant sa transmission,
la DCH ne lit pas la fiche.

**L'API** :

- `POST /v1/campagne/equipe/{agent}/dch`, `…/reprise-n2` et `…/renvoi-n2`,
  réservées à l'évaluateur de l'agent (sinon 404,
  `campagne.agent_hors_equipe`). Refus en 409 : `campagne.fiche_non_validee`,
  `campagne.fiche_chez_le_n2` (« La fiche est chez le N+2 »),
  `campagne.fiche_transmise`, `campagne.fiche_pas_chez_le_n2`,
  `campagne.fiche_non_reprise`. Reprise, la fiche se refuse au N+2 :
  `campagne.fiche_reprise`.
- `GET /v1/campagne/dch`, `GET /v1/campagne/dch/{agent}` et
  `GET /v1/campagne/dch/{agent}/pdf`, réservées à l'habilitation « Tableau
  de bord » (sinon 403) ; la fiche, une fois transmise (sinon 409,
  `campagne.fiche_non_transmise`).
- L'accueil rend le suivi en deux nombres (`dch`), pour qui a
  l'habilitation.

Aucune période ne borne la transmission : une fiche validée après la fin
de la période part à la DCH comme les autres.

**La migration 0142** ajoute à `fiches_entretien` : `reprise_n2_le`,
`transmise_dch_le` et `transmise_dch_par`, le N+1 qui l'a transmise.

## Conséquences

- La date de l'entretien ne se saisit pas pendant la campagne : le PDF
  l'imprime « À fixer ».
- Le N+1 et le N+2 n'ont pas encore leur copie du PDF, que la plateforme de
  base leur donnait.
- Rien ne prévient la DCH d'une transmission : le mode campagne n'envoie ni
  notification ni courriel.
