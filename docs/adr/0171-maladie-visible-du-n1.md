# ADR-0171 : La maladie se lit comme les autres motifs : le N+1 la voit

**Statut** : acceptée · 2026-11-03

## Contexte

Depuis la migration 0076, la maladie était un motif réservé à la DCH. Le N+1
qui visait la demande y lisait « Absence », sans le motif saisi (« Grippe »)
ni le nom du certificat ; le tableau de bord et les dossiers aussi. Seuls
l'agent, la DCH et les comptes qui ont l'accès aux données sensibles
lisaient « Maladie ». L'APIX veut que la maladie se lise comme les autres
types : le N+1 la voit.

## Décision

**La maladie n'est plus réservée à la DCH.** Le type « Maladie » se pose sans
la case « Motif réservé à la DCH » dans une nouvelle organisation, et la
migration 0129 la décoche dans les organisations existantes, pour tout type
dont le nom contient « maladie ». Le N+1, le tableau de bord et les dossiers
y lisent « Maladie », le motif saisi et le justificatif, comme pour un congé
annuel.

**La case reste** dans la fenêtre d'un type : la DCH peut encore réserver un
motif, et un motif réservé se lit comme avant.

## Conséquences

- `DEFAULT_TYPES` ne réserve plus la maladie. La migration 0129 ne touche
  que les types dont le nom contient « maladie » : un autre type réservé le
  reste.
- Les demandes passées suivent leur type : une maladie déjà visée se lit
  aussi, désormais, pour le N+1.
