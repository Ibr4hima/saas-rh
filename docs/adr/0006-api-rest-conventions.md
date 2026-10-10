# ADR-0006 — API REST /v1 : conventions MVP, plomberie publique différée

**Statut** : acceptée · 2026-08-17

## Contexte

Une seule API pour le web, la PWA et (plus tard) les intégrateurs. Revue A7 : les webhooks signés, l'Idempotency-Key exposée et la politique de dépréciation sont prématurés sans consommateur externe.

## Décision

**REST-only, préfixe `/v1`**, OpenAPI généré depuis le code, erreurs **RFC 9457** (`application/problem+json`, codes stables), **pagination par curseur opaque** partout où une liste peut grandir. GraphQL et tRPC écartés. Webhooks sortants, idempotence exposée et politique de dépréciation : implémentés à l'arrivée du premier intégrateur externe (les patterns sont documentés, pas construits).

## Conséquences

Les contrats Zod du paquet `contracts` sont la source des types côté client ; toute rupture de contrat = version additive, jamais de breaking change silencieux dans /v1.
