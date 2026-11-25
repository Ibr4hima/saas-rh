# ADR-0212 : La barre de la campagne, son titre en grand ; la connexion des agents par code

**Statut** : acceptée · 2026-11-20 · révise l'[ADR-0211](0211-mode-campagne-et-accueil.md)

## Contexte

Sur l'accueil de la campagne, la barre du haut portait le logo,
« Évaluation annuelle 2026 » en petites capitales, et le nom de la
personne. Le nom est déjà en tête de sa fiche, juste en dessous ; le titre,
lui, se perdait. La page de connexion des agents proposait encore « Se
connecter avec un mot de passe », alors que pendant la campagne les agents
entrent par leur code.

## Décision

**Le titre en grand, sans le nom.** « Évaluation annuelle 2026 » prend la
taille et la graisse du salut des accueils de la plateforme (« Bonjour,
… ») : 22 px, 25 px sur un grand écran, extra-gras. La barre se pose sur le
fond, comme celle de la plateforme (ADR-0115), avec un filet qui ne paraît
que quand la page passe dessous. À droite, le menu du compte seul. Sur
téléphone, le titre descend en tête de la page, comme le salut.

**La connexion des agents par code seulement.** En campagne, `/login`
n'affiche plus « Se connecter avec un mot de passe ». La page
`/login/mot-de-passe` reste ouverte à qui en a l'adresse : elle dépanne si
un code n'arrive pas. L'administration garde `/admin/connexion`.

## Conséquences

- Hors campagne, la page de connexion ne change pas.
- Le lien attend la réponse de l'API (`GET /v1/auth/campagne`) avant de
  paraître : il ne s'affiche pas pour disparaître ensuite.
