# ADR-0100 : Les décisions de disponibilité : la fiche saisie, une page sur le modèle de l'APIX

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0098](0098-contrats-de-travail.md)

## Contexte

L'APIX a fourni deux modèles de décision du directeur général : la mise en
disponibilité pour convenances personnelles et son renouvellement. Une page
chacun : l'en-tête et le numéro « N° … APIX/DG/DCH », l'analyse, le timbre
« Le Directeur Général » en Comic Sans MS, les visas à puces carrées,
« D E C I D E », quatre articles, puis les ampliations en bas à gauche, à
côté du pied de page. Les deux textes sont les mêmes, à l'article 1er près :
l'un met en disponibilité à compter d'un jour, l'autre proroge pour une
durée la période fixée d'abord, en nommant l'unité d'affectation. Le modèle
du renouvellement ne vise qu'un procès-verbal, celui de la direction
générale adjointe, à la date de celui de la direction générale ; son
analyse est celle de la mise en disponibilité.

## Décision

**Les deux décisions se génèrent sans agent** (ADR-0094, ADR-0098), d'une
fiche que la DCH renseigne en trois blocs. « Renseigner la demande » :
civilité, prénom, nom, poste, date de la demande et, pour le renouvellement,
l'affectation, choisie dans l'organigramme. « Renseigner la disponibilité » :
la date de prise d'effet et la date limite de reprise ; pour le
renouvellement, le début et la fin de la période initiale, la durée de la
prorogation, de un à vingt-quatre mois, et la date limite de reprise.
« Renseigner les sessions du conseil d'administration » : la date de celle
qui a nommé à la direction générale, celle de la session qui a nommé à la
direction générale adjointe. Tout est obligatoire ; la reprise suit la
prise d'effet, ou la période initiale, dont la fin suit le début. Les
schémas sont dans les contrats (`ficheDisponibiliteSchema`,
`ficheRenouvellementSchema`) ; la fiche passe d'une décision à l'autre.

**La reprise d'un renouvellement se déduit, et se corrige** : c'est le
lendemain de la prorogation, qui commence le lendemain de la période
initiale et finit selon la règle du stage (fixée du 2 janvier au 1er
juillet, prorogée de six mois : reprise le 2 janvier). La page la pose dès
que la fin de la période initiale et la durée sont connues ; la DCH peut la
changer, une autre durée ou une autre fin la recalcule.

**Le renouvellement vise les deux procès-verbaux** de la mise en
disponibilité : la décision est signée par qui dirige la direction générale,
dont la nomination se vise. Son analyse reste celle de son modèle.

**Ce qui s'accorde vient de la fiche et de l'organigramme.** La civilité
accorde « est mise », « L'intéressée sera considérée », « si elle »,
« Dossier de l'intéressée » ; le dossier de qui dirige la direction
générale, le timbre et le visa de sa nomination (« La Directrice
Générale ») ; celui de qui dirige la DCH, l'article 4 (« La Directrice du
Capital Humain est chargée »). Une place vacante garde le texte du modèle.
L'affectation s'écrit avec son article, comme dans les contrats de travail :
« Chargée d'études à la Direction du Capital Humain ».

**Une page, aux marges du modèle** (42,6 points) : Arial 12 points, les
visas à l'interligne de 1,15 du modèle, les ampliations en italique en bas à
gauche. L'en-tête est un peu plus proche de l'analyse que sur le modèle,
pour que l'article 1er du renouvellement, plus long, tienne ; quand une
saisie longue fait encore déborder la page, la décision se recompose aux
espaces serrés.

**Les coquilles se corrigent** (ADR-0095) : « APIX-SA » (ADR-0088) et
« d'APIX-SA » au lieu de « de APIX-S.A. » ; « n° » suivi d'une espace
insécable, là où le modèle l'écrit ; « Code du travail » à l'article 2,
comme au deuxième visa ; le point-virgule qui manquait au septième visa ;
« D É C I D E » accentué ; « /APIX/DG/DCH », avec sa barre comme les autres
numéros ; les accords ; l'apostrophe typographique partout ; les dates sans
zéro initial ni capitale (« 7 mai 2024 », « 25 juin 2026 », « 29 août
2025 ») ; au renouvellement, la virgule entre le nom et le poste, celle qui
ferme l'incise « initialement fixée du … au … », et « six (6) mois » sans
capitale.

## Conséquences

- La feuille prend des marges propres à un modèle, l'italique, une étiquette
  mise en forme devant un paragraphe (« ANALYSE : »), la puce carrée, le
  texte aligné à gauche ou centré, et un bloc en bas à gauche à côté du pied
  de page.
- Un groupe insécable qui laisserait sa ligne remplie à moins de 60 %, un nom
  à trois prénoms par exemple, se coupe à une espace insécable entre deux
  mots, jamais devant une ponctuation, après « n° » ni entre des guillemets.
  Les documents déjà configurés n'en changent pas : aucune de leurs lignes
  n'y vient.
- La recherche de l'unité d'affectation est commune aux contrats de travail
  et au renouvellement (`uniteDAffectation`, `documents/dossier.ts`).
