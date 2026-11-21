# ADR-0167 : On essaie l'application en mode production, et l'on développe avec Turbopack

**Statut** : acceptée · 2026-11-03

## Contexte

Lancée avec `pnpm dev`, l'application compile chaque page à sa première
visite : 1,5 à 3,7 secondes par page, 25 pour l'évaluation annuelle, puis
250 à 500 ms aux visites suivantes. Le rond « N » de Next s'anime pendant
ce temps, en bas de l'écran. C'est ainsi qu'on l'essayait, et elle
paraissait lente. En mode production, la même navigation prend de 100 à
300 ms la première fois, et 100 ms ensuite.

## Décision

**`pnpm start` lance l'application comme en production** : l'API compilée
et le site construit par `next build`, le site sur le port de `WEB_PORT`.
La commande construit d'abord ce qui a changé. C'est elle qui sert à
essayer l'application ; `pnpm dev` reste celle qui sert à la développer.

**Le développement compile avec Turbopack** : la première visite d'une page
passe de 2 à 4 secondes à environ une seconde, et de 25 à 5 secondes pour
l'évaluation annuelle.

**L'indicateur de développement disparaît** : le rond « N » ne s'affiche
plus.

**La politique de sécurité ne fait passer les requêtes en HTTPS que si la
page est servie en HTTPS.** Servie en HTTP sur un poste, la page garde
l'API locale en HTTP ; en production, derrière HTTPS, rien ne change.

## Conséquences

- Après une mise à jour, on lance `pnpm start` au lieu de `pnpm build` puis
  `pnpm dev`.
- Avec `pnpm start`, une modification du code ne se voit qu'après avoir
  relancé la commande.
