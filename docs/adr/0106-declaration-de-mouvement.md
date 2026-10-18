# ADR-0106 : La déclaration de mouvement du travailleur : la fiche, le Code du travail de 2026

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0098](0098-contrats-de-travail.md)

## Contexte

L'APIX a fourni son modèle de déclaration de mouvement du travailleur : le
formulaire que l'employeur adresse à l'administration du travail pour une
embauche, un départ ou un changement dans la situation du travailleur. Deux
pages en Times New Roman, peu ordonnées : le cadre du cachet de l'employeur,
le titre et un numéro, les références, la grille du numéro d'immatriculation
au fichier central de la main-d'œuvre et, dessous, les catégories
d'enregistrement A à F, l'objet de la déclaration (onze mouvements, « rayer
les mentions inutiles et encadrer les mentions valables ») et le blanc de la
mention « Immatriculation », l'état civil et l'emploi du travailleur, la durée du
contrat, le précédent employeur et la résidence, le statut militaire, les
dispositions particulières de l'engagement, les signatures et trois notes.

Les références du modèle citent l'article L.222 de la loi n° 97-17 du
1er décembre 1997. La loi n° 2026-18 du 3 septembre 2026 portant Code du
travail (JO n° 7931 du 17 septembre 2026) l'abroge (article 462). Son
article 363 reprend la déclaration : l'embauche se déclare à l'inspection du
travail et de la sécurité sociale du ressort, celle d'un travailleur
étranger à la Direction générale du Travail et de la Sécurité sociale avec
la demande de visa du contrat (article 105), le départ avec sa date, et un
arrêté fixe le contenu des déclarations. L'arrêté n° 7301 du 17 mai 1963,
qui le fixait, reste en vigueur (article 461).

## Décision

**La déclaration se génère sans agent** (ADR-0094, ADR-0098), d'une fiche en
six blocs : le mouvement, l'état civil, la situation de famille, l'emploi,
le statut militaire, les dispositions particulières. Le schéma est dans les
contrats (`ficheDeclarationMouvementSchema`).

**Le mouvement : une embauche, un départ ou des changements**, jamais
mêlés. Un départ se choisit parmi le licenciement, l'expiration normale du
contrat, la démission et le décès, avec la date du départ ; des changements
se cochent ensemble (mutation, catégorie, emploi, contrat, situation de
famille, résidence), avec leur date d'effet ; une embauche prend effet à
l'entrée dans l'établissement. Le mouvement déclaré s'encadre, les autres se
rayent ; « À compter du » donne la date d'effet, et un départ imprime aussi
sa date de départ de l'établissement (article 363).

**Le numéro au fichier central a dix chiffres**, une case chacun ; sans lui,
le blanc porte « Immatriculation », comme la note du formulaire le demande.
**La catégorie d'enregistrement du travailleur se choisit**, de A à F, et
s'encadre sous la grille.

**Ce qui ne vaut que dans un cas ne se renseigne que dans ce cas, et y est
obligatoire** : les épouses d'un homme marié, quatre au plus, ou l'époux
d'une femme mariée ; les dates d'un contrat à durée déterminée, l'ouvrage
d'un contrat de chantier ; la date d'entrée au Sénégal et le visa du contrat
d'une personne étrangère, dont la carte d'identité n'est pas une CNI
sénégalaise de treize chiffres ; la classe, l'armée et le grade de qui a
fait son service militaire. **Ce que la DCH peut ne pas connaître encore est
facultatif** : le numéro au fichier central, les numéros à la CSS et à
l'IPRES, la déclaration d'embauche d'un départ ou d'un changement, la date,
l'enregistrement et le visa du contrat, le précédent employeur, les
dispositions 2 à 5. Laissé vide, le formulaire garde des pointillés pour
l'écrire à la main. Ce qui ne s'applique pas se dit « Néant » ou « Sans
objet ». L'autorité qui délivre la
carte d'identité est préremplie de celle du modèle, et se corrige.

**Le formulaire se met en ordre** : les rubriques dans l'ordre du modèle, des
libellés suivis de leurs valeurs en gras, deux colonnes pour les champs
courts, une ligne entière pour les longs ; les mentions rayées d'un trait,
les mentions valables encadrées. Times New Roman, comme le modèle et les
contrats de travail. Ni en-tête ni pied de page de l'APIX : c'est un
formulaire de l'administration, que le cachet de l'employeur signe. Deux
pages ; les notes au pied de la seconde.

**Le formulaire suit le Code du travail de 2026.** Les références citent
l'article 363 et l'arrêté de 1963 sous son titre exact, « déterminant les
modalités des déclarations de mouvements de travailleurs », publié au JO
n° 3610 du 22 juin 1963, p. 835, d'après la base NATLEX de l'OIT. Le visa du
contrat est celui de la Direction générale du Travail et de la Sécurité
sociale (article 105), l'enregistrement celui de l'inspection du travail
(article 99). La première note adresse le troisième exemplaire à
l'inspection du travail et de la sécurité sociale du ressort, ou à la
Direction générale pour un travailleur étranger.

**Ce que le modèle laisse illisible se lit au mieux** : « A compter
éventuellement dans ci-dessous » devient la date d'effet du mouvement ;
« Chantier de » devient la troisième durée du contrat, celui conclu pour un
ouvrage déterminé (article 100).

**Les coquilles se corrigent** (ADR-0095) : les accents des capitales
(« DÉCLARATION », « RÉFÉRENCES », « PARTICULIÈRES », « Éventuellement ») ;
« N° d'immatriculation », « main-d'œuvre » ; « Expiration normale »,
« Modification du contrat de travail », « Durée du contrat » ; « Délivrée » ;
« Nombre d'épouses » ; « barème salarial d'APIX-SA », le nom des actes de la
DCH (ADR-0088) ; « Société de services » ; « sous-officier » ; « encadrer la
mention correcte » ; « le blanc ci-dessus » ; « de la déclaration de
mouvement au travailleur » ; « Fils de » ou « Fille de », « Né le » ou
« Née le », « L'intéressé a-t-il » ou « L'intéressée a-t-elle », selon la
civilité.

## Conséquences

- La feuille des documents peut se passer du pied de page de l'APIX, et ses
  passages peuvent être rayés ou encadrés, comme les mentions d'un
  formulaire.
- Tous les documents de la liste de la DCH ont leur modèle : aucun ne reste
  « à configurer ». Le refus demeure, pour un document qui entrerait dans la
  liste avant son modèle.
