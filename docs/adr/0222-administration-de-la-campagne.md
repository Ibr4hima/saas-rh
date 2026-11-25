# ADR-0222 : L'administration de la campagne : les dates, qui évalue qui, l'import du personnel

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0211](0211-mode-campagne-et-accueil.md) et l'[ADR-0210](0210-connexion-de-l-administration.md)

## Contexte

Pendant la campagne, l'administration importe le fichier du personnel, fixe
les dates de l'évaluation et choisit qui évalue qui (ADR-0211). Sur la
plateforme de base, les dates se fixent sur l'écran « Évaluation annuelle »
de la DCH, par la personne qui dirige la DCH, sans fin d'auto-évaluation ;
l'import du personnel se fait sur la page « Personnel ». Le choix de
l'évaluateur pour la campagne n'avait pas encore d'écran.

## Décision

**Une page « Administration de la campagne »**
(`/evaluation-annuelle/administration`), dans l'espace de la campagne,
réservée aux comptes d'administration. En campagne, un compte
d'administration arrive après sa connexion sur l'accueil de la campagne,
où une carte mène à cette page, avec la période, à côté du suivi de la DCH
(ADR-0221). La plateforme complète reste ouverte à ces comptes par son
adresse, sans lien depuis la campagne.

**En tête**, l'année et trois nombres : les agents à évaluer, les agents
sans évaluateur (en orange s'il y en a), les évaluations hors
organigramme.
À droite, « Importer le personnel » ouvre la même fenêtre que la page
« Personnel » de la plateforme.

**Les dates de l'évaluation** : le début de la période, la fin de
l'auto-évaluation et la fin de la période, toutes obligatoires, dans cet
ordre. Dessous, les deux temps tels que les agents les lisent sur leur
accueil (ADR-0220). La période commence dans l'année évaluée ou la
suivante, comme sur la plateforme de base.

**Qui évalue qui** : chaque agent à évaluer cette année, par ordre
alphabétique, avec sa direction, son N+1 dans l'organigramme et son
évaluateur pour la campagne. Le choix de l'administration porte « Hors
organigramme » ; un agent sans évaluateur porte « À désigner », en
orange. On cherche un agent par son nom ou son matricule, et on filtre
les agents sans évaluateur, ou les évaluations hors organigramme.

Le crayon ouvre le choix de l'évaluateur : tout agent en activité, sans les
règles de l'organigramme (même direction, pas de boucle). « Revenir à
l'organigramme » rend la fiche au N+1 de l'organigramme ; le choisir dans
la liste revient au même. Le choix ne touche pas à l'organigramme
(ADR-0211). Après un changement d'évaluateur, la fiche reprend où elle en
est ; une fiche transmise à la DCH ne change plus d'évaluateur.

**L'API** :

- `GET /v1/campagne/administration` : la période, et chaque agent avec son
  N+1 dans l'organigramme et le choix de l'administration ;
- `PUT /v1/campagne/administration/dates`, avec `{ du, autoAu, au }` ;
- `PUT /v1/campagne/administration/evaluateurs/{agent}`, avec
  `{ evaluateurEmployeeId }`, `null` pour revenir à l'organigramme.

Toutes sont réservées aux comptes d'administration (sinon 403,
`campagne.administration_reservee`). Refus : `campagne.dates_hors_annee`
(422), `campagne.agent_introuvable` (404, un agent hors de la campagne),
`campagne.evaluateur_soi_meme` et `campagne.evaluateur_introuvable` (422),
`campagne.fiche_transmise` (409). L'accueil dit si le compte est
d'administration (`administration`).

Aucune migration : la fin de l'auto-évaluation et l'évaluateur de la
campagne ont leurs colonnes depuis la migration 0137.

## Conséquences

- Les objectifs 2026 de chaque agent s'importeront quand la DCH aura
  envoyé son fichier.
- Les dates de la campagne se fixent ici. L'écran « Évaluation annuelle »
  de la plateforme reste à la personne qui dirige la DCH, pour les grilles
  de la plateforme de base.
