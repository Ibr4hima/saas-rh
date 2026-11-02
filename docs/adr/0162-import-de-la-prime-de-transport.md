# ADR-0162 : L'import reprend la prime de transport

**Statut** : acceptée · 2026-11-02

## Contexte

L'import ne reprenait aucune colonne de rémunération (ADR-0159) : l'aperçu
les nommait, à saisir sur la fiche. Le fichier de la DCH porte la prime de
transport de chaque agent, et la fiche a déjà sa place (ADR-0158). La
saisir à la main, agent par agent, reviendrait à recopier le fichier.

## Décision

**La colonne « Prime de transport » s'importe** dans la rémunération de la
fiche : à la création, et au réimport quand le montant change, avec le
changement dans l'aperçu (« Prime de transport : 26 000 F CFA → 30 000 F
CFA »). Une case vide n'efface rien.

**Le montant se lit comme la DCH l'écrit** : 26000, « 26 000 », « 26.000
FCFA ». Un montant qui ne se lit pas est écarté et signalé, et le reste de
la ligne s'importe.

**La rémunération reste réservée à l'accès aux données sensibles**
(ADR-0158) : sans cet accès, la prime n'est pas reprise, et l'aperçu le dit
sur la ligne.

## Conséquences

- Les autres colonnes de rémunération, la banque et l'IPRES restent à
  saisir sur la fiche ; l'aperçu continue de les nommer quand elles portent
  des valeurs.
