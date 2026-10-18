# ADR-0115 : La coquille posée sur le fond : ni bandeau bleu, ni colonne blanche

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0108](0108-boutons-aux-coins-d-e-voting.md) et l'[ADR-0110](0110-blocs-aux-coins-des-boutons.md)

## Contexte

La coquille de l'application tenait en deux pièces. Un bandeau bleu, d'un
bord à l'autre, portait le logo en blanc, le titre de l'écran, ses onglets,
son action, la date du jour et la cloche. Le menu se posait dans une carte
blanche, la carte du compte dessous, avec un bouton pour le replier en rail
d'icônes. L'APIX demande une coquille à la manière de PayFit : plus de bande
bleue, le menu directement sur le fond de la page (#FAFAFA), les blocs et les
tableaux blancs sur ce fond, et le logo de l'APIX dans ses couleurs
d'origine, orange et bleu, en thème clair. Puis : plus de bouton pour plier
le menu, et la cloche à sa place.

## Décision

**Tout se pose sur le fond de la page**, #FAFAFA en clair : le menu, le titre
de l'écran, ses commandes. Seuls les blocs et les tableaux sont blancs : le
blanc désigne ce qu'on lit et ce qu'on remplit.

**Le menu, sans carte.** En tête, le logo dans ses couleurs, le blanc pur en
sombre, où ses encres foncées se perdraient ; au bout, la cloche. Puis les
entrées, rangées par familles que sépare un blanc. Au pied, sous un filet, la
personne connectée : ses initiales, son nom, son espace ; tout ce bloc ouvre
le menu du compte, au-dessus de lui. Une rangée survolée prend un voile
d'encre ; l'entrée courante prend le blanc des blocs, cerclé de leur filet,
le mot et l'icône en bleu. Le menu ne se replie plus en rail d'icônes : il
garde sa largeur.

**La cloche s'ouvre à droite du menu**, à sa hauteur ; le voile floute la
page, pas le menu.

**L'en-tête de l'écran**, à même le fond, reste en place quand le contenu
défile ; un filet l'en sépare dès que le contenu passe dessous. Il porte le
titre de l'écran (aux accueils, le salut, la date du jour dessous) et les
onglets de la page ; à droite, l'action de l'écran, bouton plein qui dit son
mot, et la date du jour, qui mène au calendrier. La date ne s'écrit qu'une
fois par écran : sous le salut, ou parmi les commandes. Dans l'Academy,
l'en-tête garde la recherche et les raccourcis « Mes certificats » et « Ma
liste », sans la date.

**Les formes suivent l'ADR-0108, sans exception pour un bandeau** : une
commande d'icône est un rond blanc cerclé d'un filet, un bouton qui porte un
mot prend les coins des contrôles, les onglets de l'en-tête ceux de la page.

**Sur téléphone**, l'en-tête porte le logo, les commandes, la cloche et le
compte ; le titre descend en tête de la page, sur toute la largeur. La barre
d'onglets du bas ne change pas.

## Conséquences

- Le bleu de la charte reste la couleur de la structure : liens, actions,
  positions. L'aplat bleu ne vit plus que sur les couvertures de l'Academy.
- Les jetons propres au bandeau disparaissent : son liseré, le rouge des
  pastilles posées sur le bleu. Deux jetons arrivent : le voile des rangées
  du menu et le blanc de l'entrée courante.
- Le choix « menu replié » que gardait le navigateur reste sans effet.
- L'action d'un écran dit son mot : « Nouvel employé », « Nouvelle offre »,
  « Télécharger ».
- Le logo installé doit être transparent : un fond blanc se verrait sur le
  gris de la page, et deviendrait un rectangle blanc en sombre
  (`apps/web/public/README.md`).
