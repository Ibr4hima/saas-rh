# ADR-0200 : « Lois & Règlementations » se retire de Mon espace, pour l'instant

**Statut** : acceptée · 2026-11-08

## Contexte

Mon espace proposait à chaque agent la section « Lois & Règlementations » :
le Code du travail et le règlement intérieur, à lire en ligne. L'APIX ne
veut pas de cette section pour le moment ; elle pourra revenir plus tard.

## Décision

**La section ne paraît plus dans Mon espace**, et ses pages ne s'y ouvrent
plus, même par leur adresse : on revient à l'accueil.

**Le code reste** : les pages de lecture, le lecteur, l'API des textes et
leur dépôt par l'administrateur depuis Gestion RH ne changent pas. Le
drapeau `TEXTES_DANS_MON_ESPACE`, dans le menu de l'application, remet la
section à sa place.

## Conséquences

- L'administrateur dépose et relit toujours les textes depuis Gestion RH.
- Les textes déjà déposés restent en base.
