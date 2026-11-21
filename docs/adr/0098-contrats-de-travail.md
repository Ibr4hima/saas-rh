# ADR-0098 : Les contrats de travail : la fiche saisie, le modèle de l'APIX en Times New Roman

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0090](0090-arial-police-des-documents.md), l'[ADR-0094](0094-contrat-de-stage.md) et l'[ADR-0097](0097-capitales-du-lieu-et-du-poste.md)

## Contexte

L'APIX a fourni les modèles de ses contrats de travail à durée déterminée et
indéterminée : quatre pages en Times New Roman, l'en-tête de la République,
les parties (l'APIX représentée par qui dirige la direction générale ; la
personne, son état civil, sa CNI et sa délivrance, sa nationalité, son
adresse), neuf articles (engagement, durée, objet, obligations, rémunération
décomposée et treizième mois, congés, lieu de travail, clauses
particulières, résiliation), puis les signatures. Les deux fichiers portent
le même texte : celui du contrat à durée déterminée annonce « une durée
Indéterminée (CDI) », et tous deux donnent une date de fin. Comme pour le
contrat de stage, la personne n'est pas encore dans l'application.

## Décision

**Les deux contrats se génèrent sans agent** (ADR-0094), d'une fiche en
trois blocs : « Renseigner l'état civil » (civilité, CNI, prénom, nom, date
et lieu de naissance, date et lieu de délivrance de la CNI, nationalité,
adresse), « Renseigner l'emploi » (poste, catégorie, affectation, date de
début et, pour un contrat à durée déterminée, sa durée, de un à
vingt-quatre mois) et « Renseigner la rémunération » (salaire de base,
sursalaire, prime de transport, treizième mois). Tout est obligatoire. Les
schémas sont dans les contrats (`ficheCddSchema`, `ficheCdiSchema`).

**Ce qui se choisit vient de l'application.** La nationalité se choisit dans
la liste des pays de la fiche employé ; le contrat en écrit le gentilé, au
féminin, accordé à « nationalité » : « Nationalité Sénégalaise ».
L'affectation se choisit dans l'organigramme, direction, département ou
service ; le contrat l'écrit avec son article : « à la Direction du Capital
Humain », « au Service Comptabilité », « à l'Audit Interne ».

**Ce qui se déduit ne se saisit pas.** Le salaire brut est la somme de ses
trois parts : la page l'affiche, le contrat l'écrit en lettres puis en
chiffres, en gras, comme les montants des autres actes (ADR-0088). Un
sursalaire, une prime de transport peuvent être nuls. Le treizième mois
accordé ajoute sa phrase ; refusé, elle disparaît. La durée fait
l'article 2 : « une durée déterminée de douze (12) mois (CDD) », la fin
calculée comme celle du stage ; sans durée, « une durée indéterminée
(CDI) », sans fin. La civilité accorde « née », « appelée », « liée »,
« L'Employée » et les pronoms ; le dossier de qui dirige la direction
générale, « son représentant légal » ou « sa représentante légale »,
« Directeur Général » ou « Directrice Générale » ; la place vacante laisse
des pointillés.

**Le modèle se reprend en Times New Roman**, la police des deux fichiers, en
12 points, à interligne de 18 points, le titre dans son filet ; l'en-tête et
le pied de page restent ceux des autres actes. Times New Roman ne se
versionne pas plus qu'Arial (ADR-0090) : déposée ou installée, elle passe
devant Tinos, son équivalent libre aux mêmes chasses, sous licence OFL,
versionné. Les passages en rouge du modèle s'impriment en noir.

**Les coquilles se corrigent** (ADR-0095) : « APIX-SA » ; les accents des
capitales (« IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT, RÉGI PAR », « DURÉE »,
« RÉMUNÉRATION », « CONGÉS », « PARTICULIÈRES », « RÉSILIATION », « À titre
de rémunération ») ; « ainsi qu'aux textes » ; « cette loi » ; « Code du
travail » ; « l'article 1 » au lieu de « l'article 01 » ; « reste soumis » ;
« Le lieu de travail » ; « 90 % » ; « l'article 48 » ; « Lu et approuvé » ;
les virgules de l'adresse de l'APIX. Le NINEA du texte, « 28409592A3 »,
diffère de celui du pied de page, « 28409592G3 » : il est repris tel quel, à
confirmer.

**Une feuille se découpe comme Word** : un paragraphe qui passe à la page
suivante laisse au moins deux lignes de chaque côté ; un intitulé d'article
part avec la ligne qui le suit.

**Les petits mots d'un lieu ou d'une adresse gardent leur minuscule** après
le premier mot (`majusculesDesLieux`) : « Patte d'Oie Cité Impôt et
Domaines », « Saint-Louis du Sénégal », dans le contrat de stage aussi. À la
frappe, un mot qui peut encore en devenir un attend la lettre suivante
(« e » sera peut-être « et ») ; la règle entière se pose en quittant le
champ. Les prénoms et les noms gardent la règle de l'ADR-0096.

## Conséquences

- `pnpm --filter @teranga/api fonts:fetch Tinos` récupère une famille seule ;
  les fichiers déposés se nomment `times.ttf`, `timesbd.ttf`, `timesi.ttf` et
  `timesbi.ttf`.
- La liste de choix accepte la frappe sans accents : « sen » trouve
  « Sénégal ».
- La file des documents ne les génère pas.
