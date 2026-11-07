# ADR-0188 : La vérification d'un certificat à la charte de l'APIX

**Statut** : acceptée · 2026-11-07

## Contexte

La page qu'ouvre le QR code d'un certificat d'APIX Academy dit si le
certificat présenté est authentique et toujours valable. Elle gardait son
ancien habit : une carte sur un fond bleuté, le verdict en titre, les
mentions dans un tableau. Le certificat (ADR-0185) et les écrans de
connexion (ADR-0187) suivent maintenant la charte de l'APIX ; la DCH veut
cette page au même niveau.

## Décision

**La page prend la scène des écrans de connexion.** Le logo et « APIX
Academy » en tête, la courbe bleue de la charte au bas de l'écran avec le
pied, les ondulations dans le coin ; toujours en clair, en Google Sans. La
scène devient un composant partagé (`SceneDeLaCharte`) : les deux familles
d'écrans ne peuvent plus diverger.

**Le verdict d'abord, en bandeau.** En tête de la carte, sur toute sa
largeur, avec son icône : « Certificat authentique » en vert, « Certificat
expiré » en ambre, « Certificat révoqué », « Certificat introuvable » et
« Vérification impossible » en rouge.

**Puis le certificat, dans ses propres mots.** « Certificat de réussite » ou
« Certificat de formation » en capitales orange, le filet orange, « décerné
à », le nom, la formation en bleu entre guillemets, et la phrase du
certificat, le score en orange.

**En bas, disposé comme sur le papier.** Les dates à gauche (délivrance,
validité), la référence et l'émetteur à droite, le sceau d'APIX Academy au
milieu : la rosace orange, le disque bleu, le score ou une coche. Le sceau
se ternit quand le certificat est expiré ou révoqué. Sur un téléphone, il
passe au-dessus des deux colonnes.

## Conséquences

- Les intitulés suivent ceux du certificat : « Référence » au lieu de
  « Numéro », « Validité » au lieu de « Valable jusqu'au » et « Expiré le ».
  Les dates s'écrivent en entier, comme sur le certificat : « 25 septembre
  2026 ».
- Le score n'a plus sa ligne : la phrase du certificat et le sceau le disent.
- La page tient sans défilement sur un écran de 1280 × 680 ; sur un
  téléphone, elle défile un peu.
- Le fond bleuté de l'ancienne page (`.fond-certificat`) quitte la feuille
  de style.
