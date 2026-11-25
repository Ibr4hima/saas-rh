# ADR-0282 : Les polices et le thème justes dès le premier affichage, déconnexion comprise

**Statut** : acceptée · 2026-11-25 · complète l'[ADR-0187](0187-connexion-a-la-charte.md) et l'[ADR-0227](0227-accueil-a-la-charte.md)

## Contexte

Deux sauts se voyaient :

- en rechargeant une page, le texte paraissait une à deux secondes dans une
  autre police avant Google Sans, et les titres avant Anton. Les polices
  (`font-display: swap`) n'étaient demandées qu'après la feuille de style,
  et le navigateur les redemandait au serveur à chaque chargement ;
- en se déconnectant depuis le mode sombre, l'écran de connexion, toujours
  en clair (ADR-0187), paraissait une à deux secondes en sombre : le thème
  ne passait au clair qu'une fois la page de connexion chargée.

## Décision

**Les polices** :

- Google Sans, Anton et la police des icônes sont préchargées dès la
  lecture du HTML (`<link rel="preload">`), sans attendre la feuille de
  style ;
- `font-display: block` pour Google Sans et Anton, comme pour les icônes :
  le texte attend sa police, arrivée avant le premier affichage, au lieu de
  paraître dans une autre ;
- les polices se gardent une semaine dans le navigateur, puis se relisent
  en arrière-plan pendant que l'ancienne copie sert encore
  (`Cache-Control: public, max-age=604800, stale-while-revalidate=2592000`).

**Le thème** :

- « Se déconnecter » passe en clair dès le geste, avant de quitter la page ;
- le thème suit la page avant son premier affichage, à chaque changement
  de page : en clair sur les pages qui le sont toujours, le choix de la
  personne ailleurs. Le choix gardé ne change pas : après la connexion, le
  mode sombre revient.

## Conséquences

- Au premier chargement, sur un réseau lent, le texte reste invisible le
  temps que sa police arrive, trois secondes au plus, au lieu de changer
  d'aspect sous les yeux.
- Une police remplacée sur le serveur atteint les navigateurs en une
  semaine au plus.
