# ADR-0005 — PWA Next.js, unique cible mobile jusqu'à la V1+

**Statut** : acceptée · 2026-08-17

## Contexte

Revue A6 : trois runtimes front (Next.js, Expo, Storybook) est un de trop pour un dev solo ; l'app RN n'aurait aucun utilisateur avant 12+ mois.

## Décision

Le portail employé est une **PWA Next.js mobile-first** (installable, tolérante aux coupures : cache des bulletins/soldes, file de rejeu des actions). **Aucun runtime React Native n'est maintenu** avant qu'une app native soit réellement justifiée (V1+). Les tokens du design system gardent un formatter React Native « dormant » dans Style Dictionary.

## Conséquences

L'atout Expo du fondateur reste mobilisable plus tard ; le budget perf PWA (LCP < 2 s en 3G/4G) devient le garde-fou principal.
