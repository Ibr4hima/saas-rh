# ADR-0186 : Les courriels à la charte de l'APIX

**Statut** : acceptée · 2026-11-07 · révise l'[ADR-0173](0173-papier-de-la-charte.md) sur la police des courriels

## Contexte

Les courriels de la plateforme (l'invitation au portail sous ses trois
formes, la notification, le mot de passe oublié, l'accusé de réception et le
refus d'une candidature) gardaient l'habit de l'écran de connexion : Google
Sans, une carte blanche centrée, un bouton en pilule. Le certificat d'APIX
Academy suit maintenant la charte de l'APIX (ADR-0185) ; la DCH veut ses
courriels au même niveau.

## Décision

**Un seul gabarit pour tous les courriels, à la charte.**

- Une feuille blanche de 600 px aux coins de 8 px, sur le fond #F5F7F9.
- En tête, le logo à gauche et « Direction du Capital Humain » à droite, en
  Anton bleu, au-dessus d'un filet.
- Un surtitre en capitales orange dit de quoi parle le courriel : « Portail
  RH », « Notification » ou « Recrutement ». Puis le titre en Raleway gras,
  souligné d'un filet orange, et le message, aligné à gauche.
- Un seul bouton, bleu #004F91 aux coins de 8 px, sans flèche. Sous lui,
  « Le bouton ne fonctionne pas ? Copiez ce lien. » : le mot « lien » mène
  au même endroit que le bouton.
- En bas de la feuille, la courbe bleue de la charte, soulignée d'orange,
  avec ses ondulations, comme au bas du certificat. Puis le pied, centré,
  en Exo : les droits, le message automatique, le réglage des notifications.

Les textes ne changent pas.

**Les polices de la charte, servies par le site.** Raleway, Exo et Anton en
woff2, sous-ensembles latin et latin étendu (86 Ko pour le latin). Les
messageries qui chargent les polices les prennent ; les autres retombent sur
Segoe UI, Roboto, Helvetica ou Arial. Raleway y écrit ses chiffres alignés.

**Chaque effet a son repli.**

- Outlook sur Windows : la mise en page tient dans des tableaux, les
  espacements dans des cellules ; le bouton reste arrondi (VML).
- Petit écran : sous 620 px, le texte et le bouton prennent toute la largeur,
  et le service passe sous le logo.
- Thème sombre : le fond s'assombrit, la feuille reste blanche. Le logo
  arrive sur son propre fond blanc arrondi, sa zone de protection : une
  messagerie qui assombrit tout le garde lisible.
- Images bloquées : « APIX » s'écrit à la place du logo ; la courbe, qui ne
  fait que décorer, ne manque pas à la lecture.
- Typographie française : des espaces insécables avant « ? » et « : », et
  dans les dates, que les messageries ne coupent plus.

## Conséquences

- Le courriel charge deux images du site : `/courriel/logo.png`, le logo sur
  son fond blanc, 48 px de haut, et `/courriel/bande.png`, la courbe, 600 ×
  64 px, tracée deux fois plus fine.
- Six fichiers de police et leurs licences rejoignent
  `apps/web/public/fonts/` ; `pnpm --filter @teranga/web fonts:mail` les
  régénère.
- Google Sans reste la police de l'interface ; les courriels ne la chargent
  plus.
- Le texte brut des courriels ne change pas.
- Un courriel déjà en file part avec le nouveau gabarit : il se compose au
  moment de partir.
