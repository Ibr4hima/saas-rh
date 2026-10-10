# ADR-0032 : L'absence ponctuelle, à l'heure ou à la journée, plafonnée par demande

**Statut** : acceptée · 2026-10-08

## Contexte

Un agent s'absente quelques heures pour un rendez-vous important, une
journée ou deux pour un baptême ou un décès. Ces absences n'avaient pas de
type, et une demande ne se posait qu'en journées entières.

## Décision

**Un type « Absence ponctuelle », posé d'office.** Sans justificatif, sans
solde, trois jours ouvrés au plus par demande, en attendant que la DCH fixe
son plafond. Les tenants en service le reçoivent par la migration 0096 ; un
nouveau tenant, avec les autres types.

**Un type peut se demander à l'heure** (`allows_hours`). La demande garde
alors ses heures (`start_time`, `end_time`) : un seul jour ouvré, entre
8 h et 17 h, au quart d'heure dans le formulaire. Quelques heures comptent
pour une part de journée (deux heures font 0,25 jour, sur huit heures par
jour) ; les écrans disent la durée en heures. Ce qui se décompte d'un solde
se prend à la journée, car les soldes se tiennent en jours (contrainte
`absence_types_heures_hors_solde`).

**Tout type peut plafonner une demande** (`max_days_per_request`, en jours
ouvrés), réglé dans les paramètres des absences. Le serveur refuse
au-delà ; le formulaire le dit avant l'envoi.

**Le chevauchement se lit à l'heure près.** L'exclusion
`absence_requests_no_overlap` compare des intervalles horodatés : deux
rendez-vous du même jour tiennent ensemble s'ils ne se croisent pas, aucun
ne tient dans une journée déjà posée.

**Quelques heures ne font pas un absent.** L'agent reste là dans la
journée : son N+1 garde la main sur les visas, un membre de la DCH sur ce
qu'il traite, et ses courriels ne se mettent pas en pause. Validée pour
plus tard dans la journée, l'absence s'annule encore ; ses heures passées,
elle quitte le calendrier des absences.

**Les heures s'écrivent à la française** (« 10 h 30 »), et le formulaire
n'utilise pas le champ d'heure du navigateur, qui afficherait AM et PM
selon sa langue.

## Conséquences

- Le plafond de trois jours est provisoire : la DCH le règle dans
  « Paramètres des absences », colonne « Durée max ».
- La plage de 8 h à 17 h est fixée dans les contrats ; une autre plage
  demande une modification du code.
- Un jour à l'heure devenu férié annule la demande, comme une journée.
