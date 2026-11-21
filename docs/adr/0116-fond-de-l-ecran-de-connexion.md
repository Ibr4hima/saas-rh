# ADR-0116 : Le fond de l'application, celui de l'écran de connexion

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0115](0115-coquille-posee-sur-le-fond.md)

## Contexte

Depuis l'ADR-0115, le menu, le titre de l'écran et ses commandes se posent à
même le fond de la page : #FAFAFA en clair, un gris neutre. L'écran de
connexion se pose, lui, sur un blanc à peine bleui, #F3F6FA. L'APIX demande
ce même fond pour toute l'application.

## Décision

**Le fond de l'application est celui de l'écran de connexion** : #F3F6FA en
clair. L'écran de connexion le lit désormais dans le même jeton (`--tg-bg`) :
les deux ne peuvent plus diverger. Le thème sombre ne change pas : l'écran de
connexion de nuit se dissout déjà dans le fond de l'application.

**Tout ce qui prend le fond de la page le suit** : le cadre des onglets, les
notes posées dans les blocs, le corps des fenêtres. Les blocs, les tableaux et
l'entrée courante du menu restent blancs, et s'en détachent mieux.

## Conséquences

- Les survols posés sur le blanc des blocs restent des gris chauds ; dans le
  menu, le voile d'encre fonce le fond sans le teinter.
- Le texte secondaire garde son contraste sur ce fond : 5,8:1, au-dessus du
  seuil de 4,5:1.
