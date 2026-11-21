# ADR-0233 : Les pages de la campagne à la charte de l'APIX

**Statut** : acceptée · 2026-11-21 · révise les ADR [0215](0215-formulaire-d-auto-evaluation.md), [0216](0216-evaluation-par-le-n1.md), [0217](0217-validation-par-l-agent.md), [0218](0218-commentaires-du-n2.md), [0221](0221-transmission-a-la-dch.md), [0222](0222-administration-de-la-campagne.md) et [0227](0227-accueil-a-la-charte.md)

## Contexte

L'accueil de la campagne a pris la charte de l'APIX (ADR-0227, ADR-0228).
Ses autres pages gardaient l'en-tête blanc de la plateforme, des cartes
d'étape à icône et des cartes titrées en petites capitales. L'APIX veut le
même style partout.

## Décision

**En tête de chaque page, un bandeau**, comme sur l'accueil :

- pour un agent (sa page chez le N+1, chez le N+2, sa fiche lue par la
  DCH) : ses initiales, son nom et son poste sur le bleu, puis le filet
  orange et ses repères ;
- pour les autres pages (« Mon auto-évaluation », « Mon évaluation », le
  suivi de la DCH, l'administration) : l'icône de la page dans le même rond,
  son titre et sa précision, puis les repères de la page.

Le geste de la page passe dans le bandeau, en blanc : « Télécharger le
PDF », « Importer le personnel ». La coche bleue d'une étape faite y passe
en blanc, sa coche en bleu.

**Les étapes d'une fiche** (auto-évaluation, évaluation du N+1,
commentaires du N+2, transmission à la DCH) tiennent dans une seule carte,
séparées d'un filet, numérotées « 01 » à « 04 » en Anton orange, comme les
temps de la période sur l'accueil : côte à côte sur un grand écran, deux
par deux ou l'une sous l'autre ailleurs.

**Les parties de la fiche** (« Récapitulatif et faits marquants »,
« Évaluation des résultats »…) ont leur titre en Anton, en capitales,
souligné d'orange, au-dessus de leur carte ; « Rempli par l'agent » ou
« Rempli par le N+1 » à sa hauteur, à droite ; la phrase qui introduit la
partie, dessous. Il en va de même pour « Fiches de l'année » au suivi de la
DCH, « Dates de l'évaluation » et « Qui évalue qui » à l'administration, la
recherche et le filtre à droite du titre. Sur un téléphone, ce qui se
trouve à droite du titre passe sous son filet.

## Conséquences

- Toutes les pages de la campagne se ressemblent : bandeau, étapes
  numérotées, titres en Anton. Les contenus et les gestes ne changent pas.
- Les pièces communes vivent dans `components/campagne/charte.tsx` (le
  bandeau d'un agent, celui d'une page, le titre de section), qui remplace
  `accueil.tsx`.
- Hors campagne, la plateforme garde son en-tête blanc.
