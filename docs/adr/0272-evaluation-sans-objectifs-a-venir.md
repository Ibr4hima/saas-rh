# ADR-0272 : L'évaluation ne fixe plus les objectifs de l'année suivante

**Statut** : acceptée · 2026-11-24 · remplace l'[ADR-0239](0239-trois-a-cinq-objectifs-a-venir.md) dans l'évaluation, révise l'[ADR-0205](0205-fiche-d-entretien-annuel.md), l'[ADR-0208](0208-fiche-d-entretien-vierge.md), l'[ADR-0237](0237-puce-des-objectifs-raccourcie.md) et l'[ADR-0262](0262-aide-a-la-redaction-des-objectifs.md)

## Contexte

Jusqu'ici, le N+1 fixait les objectifs de l'année suivante pendant
l'évaluation : de trois à cinq, dans la partie 5 de la fiche, « Objectifs et
perspectives pour 2027 » (ADR-0239), avec l'aide « Comment définir des
objectifs ? » (ADR-0262).

L'APIX change d'approche. Il y aura deux campagnes distinctes : l'évaluation
en fin d'année, la fixation des objectifs en début d'année. Pendant
l'évaluation, rien ne doit annoncer la campagne des objectifs.

## Décision

**La partie 5 devient « Besoins et projets de formation »**, remplie par le
N+1, avec un seul tableau : la formation souhaitée et sa justification. Le
texte d'introduction dit : « Les formations que le N+1 juge nécessaires. »
Ni le formulaire, ni la lecture, ni le PDF, ni la fiche vierge ne parlent
plus des objectifs de l'année suivante.

**Le contrat** retire `objectifsAVenir` de l'évaluation du N+1, et
l'évaluation n'exige plus ses trois objectifs pour partir à l'agent. Une
évaluation écrite avant garde ces objectifs en base, mais ils ne se
relisent plus. Le schéma d'un objectif à venir (`objectifAVenirSchema`) et
la règle de trois à cinq restent dans le contrat pour la campagne des
objectifs.

**L'aide « Comment définir des objectifs ? »** quitte l'évaluation. Le
composant reste, pour la campagne des objectifs.

**Sur l'accueil**, la puce « Fixez ensemble vos objectifs de l'année à
venir. » disparaît (ADR-0237). « Évaluation par le N+1 » garde deux puces.

## Conséquences

- Les objectifs de l'année en cours, eux, restent évalués : l'agent et le N+1
  continuent d'apprécier ceux qui ont été fixés pour l'année.
- La colonne de justification des formations garde son intitulé, « lien
  avec le poste et les objectifs » : il parle des objectifs de l'agent, pas
  de ceux de l'année suivante.
