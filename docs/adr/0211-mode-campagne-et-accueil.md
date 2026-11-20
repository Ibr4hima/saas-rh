# ADR-0211 : Le mode campagne et l'accueil de l'évaluation annuelle

**Statut** : acceptée · 2026-11-20 · complète l'[ADR-0210](0210-connexion-de-l-administration.md)

## Contexte

Pendant la campagne de 2026, la plateforme ne montre à ses agents que
l'évaluation annuelle : pas de menu, pas d'espace DCH ni DG, aucun autre
module. Qui se connecte doit avoir l'impression d'une plateforme faite pour
l'évaluation seule. L'administration garde tout : l'import du personnel, les
dates de l'évaluation, le choix de qui évalue qui.

L'évaluation de 2026 suit l'ancienne hiérarchie. Dans l'organigramme de la
plateforme, le N+1 d'un agent obéit à des règles (même direction, pas de
boucle). Pour la campagne, l'administration doit pouvoir choisir
l'évaluateur librement, sans toucher à l'organigramme, qui servira après
l'évaluation.

## Décision

**Le mode campagne, par une variable d'environnement.** Avec
`CAMPAGNE_D_EVALUATION=2026`, l'API ajoute l'année à la session
(`campagne`), et l'application web envoie tout compte qui n'est pas
d'administration sur `/evaluation-annuelle`, quelle que soit l'adresse
demandée. Vide, la plateforme est complète pour tout le monde. Les comptes
d'administration gardent la plateforme complète dans les deux cas.

**Les écrans de connexion aussi.** En campagne, leur signature devient
« Plateforme d'évaluation annuelle · Année 2026 », au lieu de « Système de
Gestion des Ressources Humaines », et l'onglet « Évaluation annuelle · APIX
S.A ». Ces écrans précèdent la session : ils demandent l'année à l'API par
une route publique, `GET /v1/auth/campagne` (`{ annee }`, `null` hors
campagne). Le temps de la réponse, la signature reste vide.

**Une coque sans menu.** En haut, une barre : le logo, « Évaluation
annuelle 2026 », le nom de la personne et son menu (le mode sombre et la
déconnexion, sans notifications ni certificats). Dessous, la page, à la
largeur des pages de la plateforme.

**L'accueil, en trois blocs.**

- La fiche de la personne, comme l'en-tête de son dossier : le nom, le
  matricule et le poste ; en repères, la direction (son abrégé, le nom
  complet en infobulle), le département et le service quand il y en a, le
  N+1 et le statut (« Cadre » ou « NC »).
- Son auto-évaluation : où elle en est (à venir, à faire, en cours,
  transmise, non transmise) et sa période.
- Si la personne évalue des agents, son équipe : une carte par agent
  (initiales, nom, poste, matricule) avec l'état de son auto-évaluation, en
  deux groupes, faite puis en attente. Une auto-évaluation faite rend la
  carte cliquable : elle ouvre `/evaluation-annuelle/equipe/{agent}`, où
  l'évaluation par le N+1 prendra place. Cette page ne s'ouvre qu'à
  l'évaluateur de l'agent ; pour tout autre compte, l'agent est introuvable
  (404, `campagne.agent_hors_equipe`).

**La fiche de l'année : `fiches_entretien`** (migration 0137). Une ligne par
agent et par année : l'évaluateur choisi par l'administration
(`evaluateur_employee_id` ; vide, le N+1 de l'organigramme),
l'auto-évaluation (`auto`) et le moment de sa transmission
(`auto_transmise_le`). L'évaluateur de la campagne se lit
`COALESCE(evaluateur_employee_id, manager_employee_id)` : le choisir ne
modifie pas l'organigramme.

**La fin de l'auto-évaluation : `evaluation_periodes.auto_au`.** La période
de l'année va du `du` au `au`. L'auto-évaluation se fait du `du` au
`auto_au` (toute la période s'il est vide), puis le N+1 évalue jusqu'au
`au`.

Le périmètre de l'évaluation ne change pas : un dossier en activité, hors
stage, qui n'est pas au sommet de l'organigramme.

## Conséquences

- Le formulaire de l'auto-évaluation, l'évaluation par le N+1 et les pages
  de l'administration (dates, évaluateurs) se construisent sur cette base.
- Seuls les écrans changent : en mode campagne, l'API garde toutes ses
  routes, avec les droits habituels de chaque compte.
- Après la campagne, vider la variable rend la plateforme complète ; les
  fiches de l'année restent en base.
