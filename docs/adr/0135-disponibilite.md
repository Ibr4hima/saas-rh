# ADR-0135 : La disponibilité, trois ans au plus, renouvelable ; l'agent demande le renouvellement

**Statut** : acceptée · 2026-10-19 · précise l'[ADR-0032](0032-absence-ponctuelle-a-l-heure.md) et l'[ADR-0100](0100-decisions-de-disponibilite.md)

## Contexte

Une disponibilité éloigne l'agent du service pour des années, sans solde à
décompter. Elle dure trois ans au plus et se renouvelle : les documents de
l'APIX ont une décision de mise en disponibilité et une décision de
renouvellement. Les paramètres des absences n'avaient pas ce type, et la
durée max d'un type ne se donnait qu'en jours ouvrés, 365 au plus
(ADR-0032) : trois ans ne se disaient pas.

## Décision

**Un type « Disponibilité », posé d'office** : sans quota, sans
justificatif, trois ans au plus par demande, renouvelable. Les tenants en
service le reçoivent par la migration 0120, à moins d'en avoir déjà un ou
de l'avoir retiré ; un nouveau tenant, avec les autres types.

**La durée max d'un type se donne en jours ouvrés ou en années**, l'une ou
l'autre (`max_days_per_request`, `max_years_per_request`, de 1 à 10 ans).
Dans la fenêtre du type, « Durée max par demande » prend un nombre et son
unité, « Jours ouvrés » ou « Ans ». Une durée en années va jusqu'à la
veille du même jour, autant d'années plus tard : à partir du 1er novembre
2026, trois ans mènent au 31 octobre 2029 ; à partir d'un 29 février, à
un 28 février. Le serveur refuse au-delà (`absence.duree_max`) ; la
fenêtre de demande borne la date de fin et le dit avant l'envoi.

**Une durée max en années peut se renouveler** (`renouvelable`, la case
« Durée max renouvelable »). Le tableau écrit « 3 ans renouvelable ».

**L'agent demande le renouvellement depuis son espace.** Tant que sa
période validée est en cours, jusqu'à son dernier jour, « Absences &
Congés » offre « Demander un renouvellement » : l'agent choisit d'un à
trois ans, et la période suivante commence le lendemain de la fin. La
demande suit le circuit de toute demande ; elle garde la période qu'elle
renouvelle (`renouvelle_id`), et se dit renouvellement : « Awa Diop
demande le renouvellement de sa disponibilité, du 2 novembre 2029 au
1er novembre 2031 ». Une période déjà suivie d'une demande ne se
renouvelle plus.

**Les notifications disent « une disponibilité »**, au féminin, comme
« une mission » : pas « un congé disponibilité ».

**La décision de renouvellement proroge de trois ans au plus**, comme la
disponibilité se renouvelle : la durée de la prorogation va de un à
trente-six mois, au lieu de vingt-quatre (ADR-0100).

## Conséquences

- Les autres règles du type sont celles d'un nouveau type : ni continuité
  du service, ni justificatif. La DCH les règle dans « Paramètres des
  absences ».
- Le renouvellement n'a pas de limite de nombre : chaque période renouvelée
  se renouvelle à son tour.
- Le dernier jour d'une durée en mois se calcule d'une seule façon pour le
  stage, le contrat de travail et la disponibilité.
- Pour un type qui ne se décompte pas, la fenêtre de demande dit le solde
  en une case, quelle que soit la longueur de la période.
