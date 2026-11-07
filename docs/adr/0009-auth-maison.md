# ADR-0009 — Auth maison : Argon2id, sessions opaques, MFA TOTP

**Statut** : acceptée · 2026-08-17

## Contexte

Auth0/Clerk : coût par utilisateur rédhibitoire à l'échelle (chaque employé est un utilisateur), dépendance externe sur le composant le plus critique. Keycloak self-hosted : lourdeur d'exploitation pour 1-2 devs.

## Décision

Authentification interne : **Argon2id** pour les mots de passe, **sessions serveur opaques** (token aléatoire ≥ 256 bits, stocké haché, cookie `HttpOnly` + `Secure` + `SameSite=Lax`), rotation à la connexion, révocation en base. **MFA TOTP obligatoire** pour les rôles sensibles (admin, RH, paie) dès le Lot 1. SSO OIDC (clients entreprise) en phase 2 — l'architecture des identités (Person ≠ User) le permet sans refonte.

## Conséquences

Rate limiting sur les endpoints d'auth ; verrouillage progressif après échecs ; les tokens de session ne sont jamais loggés ; réinitialisation par email avec tokens à usage unique.
