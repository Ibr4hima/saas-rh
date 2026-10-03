# ADR-0011 — Signature électronique à deux étages

**Statut** : acceptée · 2026-08-17

## Contexte

Vision fondateur : e-signature « niveau bancaire » (ch. 01 §6.6). Construire une signature qualifiée exige une PKI et un statut de tiers de confiance certifié — hors de portée et hors métier.

## Décision

- **V1 — signature avancée maison** pour les documents internes (contrats de travail, avenants, attestations) : authentification du signataire (session + OTP SMS/email), consentement explicite horodaté, **scellement cryptographique du PDF** (hash SHA-256 du document + méta signataire, chaîné dans un registre append-only), piste d'audit complète, vérification d'intégrité en un clic.
- **V2 — signature qualifiée** via prestataire certifié (à sélectionner), pour les documents à forte valeur contentieuse.
- Cadre juridique : loi sénégalaise 2008-08 sur les transactions électroniques — valeur probante et exigences exactes **à vérifier avec l'avocat** avant de vendre la feature.

## Conséquences

Le module Documents stocke versions + empreintes dès le Lot 1 ; le registre de scellement réutilise le patron append-only de l'ADR-0008.
