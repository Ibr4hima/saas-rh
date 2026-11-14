# ADR-0083 : L'ancienneté est celle du contrat en cours ; le stage n'en donne pas

**Statut** : acceptée · 2026-10-15

## Contexte

La fiche comptait l'ancienneté depuis la date d'embauche du dossier, moins
les jours passés hors de l'APIX entre un départ et un retour, pour tout
dossier actif, stages compris : « 2 mois, depuis le 3 août 2026 » pour un
stage commencé ce jour-là. Après un départ et un retour, les années d'avant
le départ restaient comptées. Le tableau de bord faisait de même pour
l'ancienneté moyenne : il écartait les stages du jour, mais comptait les
contrats de consultant, les détachements et les dossiers sans contrat en
cours.

## Décision

**L'ancienneté est celle du contrat en cours, et seuls le CDI et le CDD en
donnent.** Elle court depuis le premier jour de la suite de contrats que le
contrat en cours prolonge :

- un renouvellement sans écart, ou moins d'un mois après la fin du contrat
  précédent, prolonge la suite : les contrats se cumulent, et seuls les
  jours de l'écart ne comptent pas ;
- un écart d'un mois ou plus l'interrompt, entre la fin d'un contrat et le
  début du suivant comme entre un départ et un retour : l'ancienneté repart
  du premier jour du nouveau contrat, ou du retour. Le mois se compte au
  calendrier.

Ainsi, un CDI de 2018 à 2023, un départ, puis un retour en 2025 : en 2026,
un an d'ancienneté. Un CDD de deux ans renouvelé dans le mois pour deux
ans : quatre ans à la fin du second. Renouvelé un mois ou plus après sa
fin : l'ancienneté repart de zéro.

**Le stage ne donne pas d'ancienneté**, et interrompt la suite : après un
stage, l'ancienneté part du premier CDD ou CDI. Sur la fiche d'une personne
en stage, « Début du stage » remplace « Ancienneté » : le premier jour du
stage, prolongations comprises (un nouveau contrat de stage dans le mois
prolonge le même stage). Une fiche inactive dont le dernier jour tombe
pendant un stage dit de même le début du stage. Un contrat de consultant ou
un détachement, qui ne se signent plus, ne donnent pas d'ancienneté non
plus, pas plus qu'un dossier sans contrat.

**L'ancienneté moyenne du tableau de bord se compte de même**, sur les seuls
agents en CDI ou en CDD aujourd'hui. Un seul calcul, côté serveur, sert la
fiche et le tableau de bord.

## Conséquences

- La date d'embauche du dossier ne sert plus à l'ancienneté. Sous
  l'ancienneté, la fiche dit « Depuis le » et le premier jour de la suite de
  contrats, pour un dossier actif comme inactif.
- Un départ ne clôt pas le contrat, et un nouveau contrat arrête le
  précédent la veille de son premier jour : les écarts se lisent donc aussi
  dans les départs et les retours inscrits au dossier.
- Un intitulé de poste ne fait pas un stage : seul le type du contrat
  compte. Un poste intitulé « Stagiaire RH » sous CDD garde une ancienneté.
