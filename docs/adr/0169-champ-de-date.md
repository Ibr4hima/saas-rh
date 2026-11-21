# ADR-0169 : Les dates se tapent en jj/mm/aaaa et se choisissent dans notre calendrier

**Statut** : acceptée · 2026-11-03

## Contexte

Les dates se saisissaient dans le champ du navigateur : ses segments
« mm/dd/yyyy » sur une machine réglée en anglais, son icône, et un
calendrier du système, à ses couleurs et dans sa langue. L'APIX le trouve
trop « web » : la seule pièce de l'application qui ne lui ressemble pas. Les
listes déroulantes avaient le même défaut, réglé en dessinant la liste
nous-mêmes, le `<select>` caché sous un bouton.

## Décision

**Une date se tape en jj/mm/aaaa.** Les barres se posent à la frappe :
« 12032024 » donne « 12/03/2024 ». « 1/3/2024 » se lit, et devient
« 01/03/2024 » une fois le champ quitté ; une date collée en AAAA-MM-JJ
aussi. Une date impossible (31/02/2024), ou laissée incomplète, borde le
champ de rouge et ne compte pas comme saisie.

**L'icône, ou un clic dans le champ, ouvre notre calendrier**, sous le champ,
ou au-dessus quand la place manque. La semaine commence le lundi, les mois
et les jours sont en français, aujourd'hui en bleu, la date choisie en
plein. Le titre mène aux mois et aux années : une date de naissance se
trouve en trois clics. Les jours hors des bornes du champ sont grisés : une
CNI de plus de dix ans, une échéance avant aujourd'hui. « Aujourd'hui » se
propose quand le jour est permis, « Effacer » pour l'échéance d'un objectif.
Au clavier, la flèche vers le bas entre dans le calendrier ; les flèches,
Page précédente et Page suivante y circulent, Entrée choisit, Échap ferme.
Au doigt, un clic dans le champ ouvre le clavier numérique, et le
calendrier attend l'icône.

**Partout dans l'application** : toute date passe par `Input type="date"`,
qui rend désormais ce champ. La page « Générer des documents » et
l'échéance des objectifs à venir, qui avaient leur propre champ, le prennent
aussi.

## Conséquences

- `DateInput` et `CalendrierFlottant` (`@teranga/ui`, `date.tsx`) ; `Input`
  rend le premier pour `type="date"`.
- Le champ du navigateur reste, caché : il tient la valeur en AAAA-MM-JJ,
  porte le `name` et la référence de `react-hook-form`, et reçoit un vrai
  événement à chaque date complète. Les formulaires n'ont rien changé à leur
  code ; une date incomplète leur arrive vide.
- Les bornes ne bloquent pas la frappe : une date tapée hors bornes
  s'écrit, et les règles de la page (ADR-0133) disent ce qui ne va pas,
  comme avec le champ du navigateur.
