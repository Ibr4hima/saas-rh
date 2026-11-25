# ADR-0213 : Le fond clair de l'application revient à #FAFAFA

**Statut** : acceptée · 2026-11-20 · révise l'[ADR-0173](0173-papier-de-la-charte.md) pour le fond de l'application

## Contexte

Le fond clair de l'application était #FAFAFA, un gris neutre (ADR-0115,
ADR-0116). Il a pris ensuite une teinte bleutée (ADR-0143 à ADR-0145), puis
le gris froid de la charte de 2026, #F5F7F9 (ADR-0173). Le retour au fond
d'origine est demandé : plus neutre, il laisse le blanc des cartes et les
couleurs de la marque parler seuls.

## Décision

**En clair, le fond des pages est #FAFAFA**, celui de l'écran de connexion
aussi : le jeton `--tg-bg`. Le texte secondaire y garde 6:1. Le mode sombre
ne change pas. Les gris des cartes (en-tête des tableaux, filets, survol)
restent ceux de l'ADR-0144.

## Conséquences

- La page publique d'une offre et les courriels gardent #F5F7F9, le gris de
  la charte : ils ne font pas partie des écrans de l'application.
- Le reste de l'ADR-0173, le papier des documents de la DCH, ne change pas.
