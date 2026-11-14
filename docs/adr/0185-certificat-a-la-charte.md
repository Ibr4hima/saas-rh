# ADR-0185 : Le certificat d'APIX Academy à la charte de l'APIX

**Statut** : acceptée · 2026-11-07 · révise l'[ADR-0173](0173-papier-de-la-charte.md) et l'[ADR-0090](0090-arial-police-des-documents.md) sur la police du certificat

## Contexte

Depuis l'ADR-0173, les documents de la DCH suivent la charte graphique de
l'APIX de 2026. Le certificat d'APIX Academy était resté à part : Google
Sans, la police du site, un bleu seul, le QR code en haut à droite. La DCH
le veut à la charte, au niveau des autres supports de l'APIX.

## Décision

**Le certificat reprend les couleurs, les polices et les motifs de la
charte.**

- Le bleu #004F91 et l'orange #CA631F ; l'anthracite #383838 et le gris
  ardoise #546775, deux couleurs secondaires de la charte, pour le texte.
- Anton pour « CERTIFICAT » et « APIX ACADEMY », Raleway pour le texte,
  Exo pour les mentions : matricule, intitulés des dates, référence,
  adresse de vérification.
- En bas, la courbe bleue du papier à en-tête, soulignée d'un liseré orange
  comme sur le communiqué de presse de la charte, avec les ondulations du
  dos de la charte. Les mêmes ondulations, à peine visibles, dans le coin
  opposé au logo.
- Sous le titre, un filet orange.

**La page se lit de haut en bas.** En tête, le logo sur le blanc, dans sa
zone de protection, « APIX ACADEMY » à droite et un filet fin. Au centre,
« CERTIFICAT », puis « DE RÉUSSITE » ou « DE FORMATION », le nom et le
matricule, la formation, et la phrase qui dit le score ou les leçons
validées. Sur la bande : la date de délivrance et la validité à gauche ; la
référence, l'adresse de vérification et le QR code à droite.

**Un sceau, à cheval sur la courbe, porte le score.** Une rosace orange, un
disque bleu, « APIX ACADEMY » en haut de l'anneau et « RÉUSSITE » en bas, le
score en Anton au centre. Sans évaluation, une coche et « FORMATION ». Le
score tient dans l'anneau intérieur, à 4 points au moins de son bord :
« 80 % » garde ses 25 points, « 100 % », plus large, passe à 22.

**Le QR code passe en bas à droite, sur une tuile blanche**, à côté de la
référence. L'adresse de la vérification s'écrit en clair sous la
référence, pour qui n'a pas de quoi lire le QR code.

Le texte du certificat ne change pas : il atteste une formation suivie et
une évaluation réussie, ou chacune des leçons validée (ADR-0049), et rien de
plus.

## Conséquences

- Le PDF est produit à chaque téléchargement : les certificats déjà
  délivrés sortent aussi au nouveau design, avec les mêmes données, la même
  référence et le même QR code.
- Google Sans ne sert plus dans aucun PDF et quitte les polices des
  documents (`entete.ts`). Ses fichiers TTF restent dans
  `apps/api/assets/fonts/` : les vidéos de démonstration d'APIX Academy
  s'en servent pour leurs sous-titres.
- Raleway dessine ses chiffres à l'ancienne : le certificat demande les
  chiffres alignés, comme les documents de la DCH. Sans eux, « APX-109J » se
  lirait « APX-1o9J ».
- Tout reste tracé en vecteurs, le QR code compris : le PDF pèse environ
  75 Ko, logo compris.
- Sans logo déposé, « APIX » s'écrit en Anton à sa place.
- Un nom long se resserre jusqu'à 24 points plutôt que de passer à la
  ligne ; un intitulé de formation qui tiendrait sur plus de deux lignes
  passe de 20 à 16 points.
- Le spécimen garde sa mention en tête et « SPÉCIMEN » en travers de la page.
