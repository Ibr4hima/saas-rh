# ADR-0129 : La continuité du service : l'alerte, l'appréciation de la DCH, la suppléance

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0128](0128-principal-et-backups.md)

## Contexte

Une délégation de demandes confiée à plusieurs personnes (ADR-0128) doit
toujours garder quelqu'un pour traiter, sauf force majeure. Rien n'empêchait
la personne principale et les backups d'être en congé la même semaine : les
demandes revenaient alors à qui dirige la DCH, sans que personne l'ait vu
venir. L'APIX veut qu'une demande d'absence qui laisserait une délégation sans
personne le dise, parte quand même, et soit laissée à l'appréciation de la
DCH.

## Décision

**L'alerte.** Une demande d'absence porte une alerte quand, un jour ouvré de
sa période, toutes les autres personnes d'une délégation de demandes de qui
la pose sont indisponibles : en congé validé ou demandé, à la journée. Une
mission, qui laisse joignable, ne rend pas indisponible, ni une absence de
quelques heures. Les week-ends, les jours fériés et les jours passés ne
comptent pas. L'alerte va dans les deux sens : la personne principale comme
les backups. À trois, une personne en congé et une autre qui demande la même
période, la troisième reste : pas d'alerte. Une délégation à une seule
personne n'en porte pas : qui dirige la DCH la reprend, comme toujours.
Seules comptent les personnes qui peuvent traiter : membres de la DCH, avec
un accès ouvert.

L'alerte dit qui manque, ce qui resterait sans personne, et quand : « Awa
Diop sera en congé du 26 au 30 octobre : vous seriez la seule personne
restante pour les demandes de congé et les attestations de travail du 27 au
29 octobre. » Elle se lit dans le formulaire avant l'envoi, puis sous la
période, dans la file du N+1 et dans celle de la DCH. Elle se recalcule à
chaque lecture : un congé annulé ou refusé, une délégation ajoutée
l'effacent ; deux demandes pour la même semaine la portent toutes deux
jusqu'à ce que l'une soit tranchée.

**Les types soumis.** Chaque type d'absence dit s'il y est soumis
(« Continuité du service », dans « Paramètres des absences ») : toujours (le
congé annuel), au-delà d'un jour (l'absence ponctuelle de plus d'un jour
ouvré), ou jamais (la maladie, la maternité, la mission, le sans solde : la
force majeure, ou ce que la DCH choisit). Un type nouveau ne l'est pas.

**La demande part quand même, et la DCH l'apprécie.** Qui traite les
absences et congés pour la DCH (la personne principale, les backups, ou qui
dirige la DCH) voit l'alerte. Valider passe par une confirmation qui la
rappelle ; refuser exige un motif, transmis à l'agent. Un N+1 qui traite
aussi pour la DCH apprécie de même. Validée par une personne déléguée, la
demande prévient qui dirige la DCH (« Le congé annuel de Moussa Ndiaye est
validé : plus personne pour les attestations de travail du 27 au 29
octobre »), avec un lien vers « Déléguer des tâches » pour réorganiser la
direction s'il le faut.

**La dernière personne à traiter les absences et congés.** Quand la personne
qui demande est déléguée aux absences et congés, et que toutes les autres
personnes de cette délégation seraient indisponibles un jour ouvré de sa
période, sa demande va à qui dirige la DCH après le visa du N+1, et à
personne d'autre, quels que soient son type et sa durée : quelques heures,
une maladie comprises.

**La suppléance.** La personne principale indisponible (en congé, sans accès,
à l'origine de la demande ou dans l'équipe de qui la pose), la première
personne disponible dans l'ordre des délégations la remplace : l'appel, la
fenêtre de 48 heures, le rappel. Les autres restent backups. Quand une seule
personne reste, cette personne est principale, sans backups. Au retour de la
personne principale, la suppléance cesse : l'appel revient à la personne
principale, et la fenêtre court toujours depuis l'arrivée de la demande. Cela
remplace, dans l'ADR-0128, « les backups traitent d'emblée ». Dans
« Déléguer des tâches », « En congé » suit le nom des personnes absentes
aujourd'hui.

**Personne pour traiter.** En tout état de cause, une demande que personne
ne peut traiter va à qui dirige la DCH, en congé ou non. Qui dirige la DCH
modifie les délégations à tout moment ; l'alerte, l'appel et la suppléance
suivent.

## Conséquences

- La migration 0119 ajoute `absence_types.continuite` (`toujours`,
  `au_dela_d_un_jour`, `jamais`) : les types en place décomptés d'un solde
  passent à « toujours », ceux qui se demandent à l'heure sans solde à
  « au-delà d'un jour », les autres à « jamais ».
- `POST /absence-continuite` dit l'alerte au formulaire, avant l'envoi : pour
  soi, ou pour l'agent dont qui traite les congés saisit la demande.
- Le refus sans motif d'une demande qui porte l'alerte renvoie 422
  (`absence.motif_continuite`).
- La personne qui supplée reçoit, comme la personne principale, le rappel
  quinze heures ouvrées avant la fin de la fenêtre, même sans backups.
- L'alerte ne bloque jamais une demande : la décision reste à la DCH.
