# ADR-0128 : Principal et backups : 48 heures ouvrées à la personne principale, 72 pour traiter

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0060](0060-files-de-la-dch.md) et l'[ADR-0109](0109-delegation-sans-bandeau.md)

## Contexte

Une demande déléguée à plusieurs membres de la DCH les appelait tous, et le
premier geste l'emportait. Personne n'en répondait en premier, et rien ne
disait quand la demande devait être traitée. L'APIX veut, pour chaque
délégation à plusieurs, une personne principale qui en réponde, des backups
qui prennent le relais à temps, et un délai : toute demande se traite dans
les 72 heures, sans compter les week-ends ni les jours fériés.

## Décision

**Une délégation de demandes confiée à plusieurs personnes a sa personne
principale** : les absences et congés, chaque document demandé, les mises à
jour d'informations, la vérification des documents. Les autres personnes
déléguées sont ses backups. Le choix se fait dans « Déléguer des tâches »,
dans la liste des personnes déléguées (colonne « Principal »). Sans choix, la
personne déléguée la première est principale ; une personne principale
partie ou retirée laisse la place à la plus ancienne des autres.

**La personne principale traite seule pendant 48 heures ouvrées.** L'appel
va à la personne principale ; les backups reçoivent un avis, voient la
demande dans leur file (« Awa Diop la traite jusqu'au 22 oct. à 10 h ») et
ne peuvent pas la traiter. Quinze heures ouvrées avant la fin, la personne
principale reçoit un rappel. À la fin, les backups reçoivent la demande
(« Vous pouvez traiter : … ») et la traitent aussi : le premier geste
l'emporte, et la personne principale garde la main. Avant la fin, la
personne principale peut confier la demande aux backups (« Confier aux
backups ») ; l'avis dit alors « Awa Diop vous confie : … ».

**Les heures ouvrées** : une journée ouvrée compte ses vingt-quatre heures ;
un samedi, un dimanche, un jour férié n'en comptent aucune, et un pont
(férié collé au week-end) s'enjambe de même. Une demande déposée un jour
chômé attend le jour ouvré suivant pour que l'horloge parte. La fenêtre court
depuis la demande ; pour un congé, depuis son arrivée à la DCH, après le
visa du N+1. La colonne « Temps écoulé » des demandes de documents compte ces
heures : orange passé 48, rouge passé 72 ; « Durée traitement » aussi.

**Quand la personne principale ne peut pas traiter** (en congé, sans accès
au portail, à l'origine de la demande ou dans l'équipe de qui la pose), les
backups traitent d'emblée, comme avant. Une demande confiée à la main par qui
dirige la DCH n'a pas de fenêtre, et qui dirige la DCH garde la main sur tout.

## Conséquences

- L'ouverture aux backups et le rappel passent par la veille (ADR-0067),
  chaque minute : personne n'a à écrire pour que le temps fasse son œuvre.
- Les délais (48, 15, 72) vivent au contrat, partagés par l'écran et le
  serveur.
- Une délégation à une seule personne se traite comme avant, avec la relance
  après deux jours ouvrés ; un retour de congé à confirmer n'a pas de
  fenêtre.
- Le menu ne compte, pour les backups, une demande à traiter qu'une fois la
  fenêtre ouverte.
