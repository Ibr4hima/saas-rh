# ADR-0118 : L'entrée courante du menu, en bleu très clair, sans filet

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0115](0115-coquille-posee-sur-le-fond.md)

## Contexte

Depuis l'ADR-0115, l'entrée courante du menu prenait le blanc des blocs,
cerclé de leur filet, avec une ombre fine. L'APIX la veut comme sur PayFit :
plus nette, sans liseré, en bleu très clair.

## Décision

**L'entrée courante prend un bleu très clair**, sans filet ni ombre : le
bleu pâle de la charte (`--tg-primary-soft`), lu par le jeton du menu
(`--tg-menu-actif`). Le mot passe en bleu, en demi-gras.

**Son icône passe dans un rond plein**, bleu, l'icône en blanc. Chaque icône
du menu tient dans une case de 24 px : le rond prend sa place sans décaler
le libellé.

**Une rubrique qui contient la page courante** garde son rond et son mot en
bleu ; dépliée, elle laisse le fond bleu clair à la sous-page courante, pour
ne pas empiler deux fonds.

## Conséquences

- La nuit, le fond de l'entrée courante est le bleu profond de la charte de
  nuit, le rond son bleu clair, l'icône foncée.
- Le survol des autres entrées ne change pas : un voile d'encre.
