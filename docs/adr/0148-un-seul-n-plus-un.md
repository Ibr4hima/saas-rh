# ADR-0148 : Un seul N+1, comme avant : abandon de l'ADR-0147

**Statut** : acceptée · 2026-10-23 · remplace l'[ADR-0147](0147-deux-n-plus-un.md)

## Contexte

L'[ADR-0147](0147-deux-n-plus-un.md) séparait deux N+1 : un hiérarchique,
calculé à partir de l'organigramme, et un fonctionnel, choisi librement. Ce
modèle n'est pas retenu : on revient au modèle d'avant.

## Décision

**Un seul N+1 par agent, défini comme avant l'ADR-0147.** Les règles des
[ADR-0013](0013-coherence-organigramme.md),
[ADR-0034](0034-n-plus-un-des-chefs-d-unite.md) et
[ADR-0037](0037-directeur-remplace-son-equipe-passe.md) s'appliquent de
nouveau telles qu'elles étaient, et le même N+1 vise les congés, fixe les
objectifs et évalue ([ADR-0076](0076-evaluation-annuelle.md)).

Le code revient à son état d'avant l'ADR-0147. La migration 0121 reste
appliquée, car une migration appliquée ne se supprime pas : ses colonnes ne
servent plus. La migration 0122 rend leur N+1 d'avant la règle aux agents
dont un recalcul de la chaîne l'avait changé.

## Conséquences

- Les écrans redemandent le N+1 à la création, à la mutation et au départ,
  avec la reprise d'équipe, comme avant.
- L'import relit la colonne du N+1.
- Les colonnes ajoutées par la 0121 (`n1_fonctionnel_employee_id`,
  `n1_unite_id`, `n1_dga`, `n1_avant_la_regle`) restent en base, inutilisées,
  jusqu'à une migration qui se déclarera destructive (ADR-0010).
- La refonte de la hiérarchie reste ouverte : une nouvelle proposition
  passera par un nouvel ADR.
