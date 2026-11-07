# ADR-0173 : Les documents de la DCH sur le papier de la charte de l'APIX

**Statut** : acceptée · 2026-11-06 · précise les [ADR-0086](0086-modeles-de-l-apix.md), [ADR-0090](0090-arial-police-des-documents.md), [ADR-0094](0094-contrat-de-stage.md), [ADR-0098](0098-contrats-de-travail.md) et [ADR-0145](0145-retour-au-fond-f3f6fa.md)

## Contexte

L'APIX a adopté en 2026 une nouvelle charte graphique. Elle fixe un papier
à en-tête : le drapeau du Sénégal au-dessus du bloc de la République, le
logo à droite, une courbe bleue en pied de page avec les mentions de la
société. Elle fixe aussi ses polices, Raleway pour le texte, Anton pour les
titres, Exo pour le pied de page, et un fond gris clair, #F5F7F9.

La charte vaut pour les documents. L'interface garde Google Sans et ne lui
prend que son fond clair.

Les lettres, les attestations et les décisions tenaient sur une page ; le
nouveau papier, plus haut en tête et en pied, ne doit pas les faire
déborder. Et la justification ligne par ligne laissait des blancs trop
larges entre les mots.

## Décision

**Le papier de la charte, composé en code.** En tête, à gauche, le drapeau
du Sénégal, tracé d'après son fichier officiel, au-dessus du bloc de la
République, chaque ligne centrée sur lui, aux corps et aux graisses de la
maquette. À droite, le logo : son milieu à la hauteur du milieu du bloc, du
haut du drapeau à sa dernière ligne, son bord droit sur la marge du texte.
Sous le logo, le numéro de l'acte puis, un blanc plus bas, le lieu et la
date. En pied, la courbe bleue d'un bord à l'autre et les mentions de la
société en trois colonnes, avec leurs pictogrammes (les Material Symbols de
l'application) ; le numéro de page s'y pose à droite quand le document en a
plusieurs (« 1/4 »). C'est un papier imprimé d'avance : l'en-tête et le
pied ne suivent pas les marges du texte.

**Les polices de la charte**, libres (OFL) et versionnées. Raleway pour le
texte, avec ses graisses Light, Medium et SemiBold pour le bloc de la
République ; ses chiffres à l'ancienne se lisent mal dans une date ou un
montant, la feuille demande donc ses chiffres alignés (`lnum`). Anton pour
les titres, en capitales bleues, centrés, sur une ligne s'ils y tiennent,
sinon sur deux lignes de longueurs voisines, soulignés d'un court filet
orange. Exo pour le pied. Le timbre (« Le Directeur Général ») passe de
Comic Sans MS au gras de Raleway, et Comic Sans MS quitte les documents.
Les contrats passent de Times New Roman 12 à Raleway 11, chaque interligne
du modèle à la même échelle.

**Chaque document tient sur les pages de son modèle** : une lettre, une
attestation, une décision sur une page ; un contrat de stage sur trois ; un
contrat de travail sur quatre. Un document qui déborderait se resserre, le
corps d'abord, de 11 à 10,5 puis 10 points, puis les blancs entre les
blocs, à 80 % puis 60 %. Au plus serré, s'il déborde encore, il garde sa
suite.

**Des paragraphes justifiés sans trous.** Les lignes se répartissent sur
tout le paragraphe à la fois, à la façon de TeX (Knuth et Plass) : chaque
façon de couper le paragraphe se juge sur toutes ses lignes, et la moins
mauvaise l'emporte. Une ligne coûte d'autant plus que ses blancs s'écartent
de l'espace normal, au cube et sans plafond ; un blanc se resserre de 15 %
au plus ; la dernière ligne garde l'espace normal. Un mot courant se coupe
en fin de ligne à la française, selon l'algorithme de Liang sur les motifs
français de TeX (licence MIT) : sept lettres au moins, trois de chaque côté
de la coupure ; jamais un nom propre, un sigle, un nombre ni un mot
composé ; jamais juste après une élision. Deux lignes coupées de suite, et
une avant-dernière ligne coupée, se paient plus cher.

**L'espace insécable s'étire sans céder.** Entre deux mots, elle s'étire
comme les autres blancs : « Madame Awa DIOP » ne paraît plus collé sur une
ligne lâche. Elle ne sépare jamais une civilité du nom qui la suit, ni un
nombre de ce qui le suit (« 15 octobre », « (24) mois ») ; entre deux
prénoms, entre un prénom et un nom, entre un mois et son année, elle cède
en dernier recours. Celle d'un nombre (« 650 000 », un RIB) ou d'une
ponctuation garde sa chasse et ne cède jamais.

**L'application prend le fond clair de la charte**, #F5F7F9 au lieu de
#F3F6FA, comme la page publique d'une offre d'emploi et les courriels.
Google Sans reste la police de l'interface et des courriels.

## Conséquences

- Mesuré sur des paragraphes de la domiciliation et de la décision, de 420
  à 510 points de large : le plus large blanc passe au pire de 3,4 à 1,9
  espace normale, et de 2,8 à 1,4 à la largeur d'une décision.
- Les documents types gardent leur nombre de pages. Les lettres et les
  attestations restent en corps 11, le renouvellement de disponibilité
  passe en 10,5 ; avec des saisies longues (quatre prénoms, un poste de
  cent caractères), tout tient encore sur une page.
- Le logo déposé s'aligne tel qu'il est, marges transparentes comprises :
  un fichier détouré, ou aux marges égales, tombe juste
  (`apps/api/assets/README.md`).
- Les mentions du pied suivent la charte, et le site devient
  www.investinsenegal.sn. La maquette écrit « NINIEA » : le pied garde
  « NINEA ». Ses icônes de réseaux sociaux ne sont pas reprises.
- La déclaration de mouvement, formulaire de l'administration, et les
  grilles d'évaluation gardent leurs polices (Times New Roman, Gill Sans MT,
  Arial) et leur mise en page. Le certificat d'APIX Academy garde Google
  Sans. Comic Relief quitte `apps/api/assets/fonts/`.
