# ADR-0110 : Les blocs et les tableaux aux coins des boutons

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0108](0108-boutons-aux-coins-d-e-voting.md)

## Contexte

L'ADR-0108 a donné aux boutons et aux champs les coins d'e-Voting : 8 px.
Les blocs gardaient les leurs, plus ronds : 16 px pour les cartes et les
tableaux, 18 px pour le menu latéral et la carte du compte, 14 px pour les
menus déroulants, 20 px pour les fenêtres, de 9 à 12 px pour les bandeaux et
les messages. L'APIX demande pour tous les blocs et les tableaux les coins
des boutons, exactement.

## Décision

**Un bloc a les coins d'un bouton.** Un jeton, `--tg-radius-bloc`, vaut le
rayon des contrôles (8 px) et le suit s'il change. Il habille les cartes et
les tableaux, le menu latéral et la carte du compte, les menus déroulants et
le panneau des notifications, les fenêtres, les bandeaux et les messages,
les zones de dépôt, les cartes de choix, les carrés d'icône, les aperçus de
documents, le lecteur vidéo, la carte des pages de connexion, et les
squelettes de chargement de tout cela. Les grandes cartes de choix, que
l'ADR-0108 laissait à 12 px, le prennent aussi.

**Une ligne survolée dans un bloc prend le rayon des petits contrôles**
(7 px) : les entrées du menu latéral, les options d'une liste, les lignes
d'un menu. La barre de commandes du lecteur vidéo prend le cadre d'un groupe
d'onglets (10 px), ses boutons 7 px.

**Ne changent pas** : ce qui reste rond (ADR-0108), dont la bande bleue du
haut ; le cadre d'un groupe d'onglets (10 px) et la barre de pagination
(12 px), qui entourent leurs contrôles à égale distance ; le carré du logo ;
le badge d'une formation, arrondi d'une demi-ligne pour passer à la ligne ;
les virages des traits de l'organigramme. Sur téléphone, une fenêtre s'ouvre
en plein écran, sans coins, comme avant.

## Conséquences

- Un bloc prend `rounded-bloc`, une ligne survolée `rounded-controle-sm` ;
  pas de rayon en valeur libre.
- L'éditeur de texte (BlockNote) prend le rayon des blocs.
