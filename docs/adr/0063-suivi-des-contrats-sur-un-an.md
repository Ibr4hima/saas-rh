# ADR-0063 : Suivi des contrats : la durée restante, sur un an

**Statut** : acceptée · 2026-10-12

## Contexte

Le tableau « Suivi des contrats » de l'accueil montrait tous les CDD et
stages en cours, avec « Dans 272 jours » : les contrats lointains
encombraient la liste, et un nombre de jours au-delà de quelques semaines
ne se lit pas d'un coup d'œil.

## Décision

**La colonne s'appelle « Durée restante »** et dit la durée seule, sans
« Dans » :

- sous 30 jours, en jours (« 21 jours », « 1 jour ») ;
- ensuite en mois de 30 jours : un compte rond tel quel (« 1 mois » pour
  30 jours, « 2 mois » pour 60), entre deux la borne au-dessus (« < 2 mois »
  pour 35 ou 40 jours) ;
- à partir de 365 jours, en années de la même façon (« 1 an », « < 2 ans »
  pour 370 jours) ; de 361 à 364 jours, « < 1 an ».

« Échoit aujourd'hui », « À préciser » (date de fin manquante) et « Échu ·
il y a … » ne changent pas. L'orange reste pour ce qui finit dans 30 jours
ou moins.

**Seuls les contrats qui finissent d'ici un an (365 jours) y figurent**,
avec ceux dont la date de fin manque : plus loin, ils n'appellent encore
rien. L'en-tête de la carte dit « Fin d'ici un an » ; sans contrat dans cet
horizon, « Aucun contrat ne finit d'ici un an ».

## Conséquences

- Un CDD qui finit dans treize mois n'apparaît qu'à un an de son terme.
- Le filtre se fait dans l'API (`suiviDesContrats`) : le tableau de bord en
  est la seule liste.
- Un contrat échu n'y figure pas en pratique : l'accueil passe d'abord les
  contrats échus dans les inactifs (inchangé).
