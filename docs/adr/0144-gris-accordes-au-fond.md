# ADR-0144 : Les gris des blocs, accordés au fond bleu-gris

**Statut** : acceptée · 2026-10-20 · précise l'[ADR-0116](0116-fond-de-l-ecran-de-connexion.md) et l'[ADR-0143](0143-fond-bleu-gris.md)

## Contexte

Les blocs, les tableaux et les tuiles sont du blanc pur (#FFFFFF) : on ne
peut pas aller plus loin. Sur le fond bleu-gris (ADR-0143), ils paraissent
pourtant moins blancs. Leurs gris viennent de la plateforme APIX, des gris
chauds : l'en-tête des tableaux (#FAFAF9), les filets (#D8D3CF, #ECEAE7), le
rail des barres (#EAE7E3), le survol (#F5F3F0). À côté du fond bleuté, ils
virent au beige, et le blanc qui les porte se ternit avec eux.

## Décision

**Les gris prennent la teinte du fond, à clarté égale** : le bleu-gris de la
charte (252° en OKLCH), à peine saturé. L'en-tête des tableaux et le bloc
d'une donnée prennent #F8FAFD, le survol #EFF4F9, les filets #CED5DD et
#E6EBF0, le rail des barres #E3E8EE. Le blanc des blocs ne change pas : il
paraît plus blanc parce que plus rien de beige ne l'entoure.

**Le thème sombre ne change pas.**

## Conséquences

- Chaque gris garde sa clarté, donc ses contrastes : les filets dessinent
  autant qu'avant, le survol se voit autant, la barre garde 6,7:1 sur son
  rail.
- Les survols posés sur le blanc des blocs ne sont plus des gris chauds
  (ADR-0116) : ils prennent la teinte du fond.
- Les courriels gardent leurs gris chauds, avec leur fond (ADR-0143).
