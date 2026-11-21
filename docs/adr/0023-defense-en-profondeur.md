# ADR-0023 : Défense en profondeur : pièces chiffrées, origines, en-têtes

**Statut** : acceptée · 2026-10-06

## Contexte

Aucun système n'est inattaquable. Le but est qu'une faille ne suffise
jamais : chaque couche doit tenir même si une autre tombe. Trois manques
restaient avant la mise en production :

- les pièces des agents (CNI, passeport, diplômes, CV) et les justificatifs
  d'absence (un certificat médical) étaient gardés en clair : qui lisait la
  base, ou une sauvegarde, les lisait ;
- l'API n'acceptait que les appels de `localhost` (en dur), sans contrôle
  d'origine ni en-têtes de sécurité ;
- le site n'avait pas de politique de sécurité du contenu : une donnée mal
  échappée pouvait devenir du code.

## Décision

**Les pièces se chiffrent dans l'application** (AES-256-GCM), fichier et
nom de fichier, avec une clé à elles dérivée de la clé maîtresse. Chacune
l'est pour sa place : organisation, table, ligne, colonne. Recopiée
ailleurs, elle ne se lit plus. Les pièces déjà déposées se chiffrent au
passage des migrations (migration 0090, `db/chiffrer-pieces.ts`), puis la
table se réécrit pour que le clair ne reste pas sur le disque.

**L'API ne parle qu'au portail.** Les origines autorisées sont celle de
`PUBLIC_WEB_URL` et celles de `CORS_ORIGINS`. Un geste (tout sauf une
lecture) venu d'un autre site est refusé avant toute lecture, même si le
cookie passait. Le cookie de session est `HttpOnly`, `SameSite=Strict`, et
porte en HTTPS le préfixe `__Host-`.

**Chaque réponse de l'API** interdit l'affichage dans un cadre, la
devinette du type, le cache, le référent, et en HTTPS impose HTTPS pour
deux ans (HSTS).

**Le site applique une politique de sécurité du contenu** avec un jeton
par page (nonce) : seuls ses propres scripts s'exécutent ; la page ne
parle qu'au site et à l'API, ne s'affiche dans aucun cadre, n'envoie aucun
formulaire ailleurs. Aucun référent ne part : l'adresse d'un lien
d'invitation ou de réinitialisation porte un jeton.

**La production refuse de démarrer mal réglée** : sans HTTPS
(`COOKIE_SECURE`, `PUBLIC_WEB_URL`, `CORS_ORIGINS`), avec l'inscription
ouverte, sans `TRUST_PROXY`, ou avec la clé de développement.

## Conséquences

- Le site et l'API doivent partager le même site (par exemple
  `rh.apix.sn` et `api.apix.sn`) : le cookie Strict ne passe pas d'un site
  à un autre.
- Perdre `DATA_ENCRYPTION_KEY`, c'est perdre les pièces : la clé se garde
  hors du serveur (coffre ou gestionnaire de secrets), sauvegardée à part.
- Les sauvegardes faites avant ce chiffrement contiennent les pièces en
  clair : elles se détruisent une fois la migration passée.
- Toutes les pages du site se rendent à la demande (le jeton change à
  chaque page) : plus de page statique.
- Restent hors du code : l'authentification à deux facteurs pour la DCH
  et l'administrateur, la fin de session après inactivité, le chiffrement
  des sauvegardes et des connexions à la base, un pare-feu applicatif.
