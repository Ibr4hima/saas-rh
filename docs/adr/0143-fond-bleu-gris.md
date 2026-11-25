# ADR-0143 : Le fond de l'application, un bleu-gris qui détache les blocs

**Statut** : acceptée · 2026-10-20 · précise l'[ADR-0116](0116-fond-de-l-ecran-de-connexion.md) et l'[ADR-0118](0118-entree-courante-en-bleu-clair.md)

## Contexte

Le fond de l'application, #F3F6FA depuis l'ADR-0116, est si proche du blanc
que les blocs, les tableaux et les tuiles s'en détachent à peine : 1,08:1
entre leur blanc et le fond. L'APIX demande un fond clair qui fasse ressortir
le menu et les blocs.

## Décision

**Le fond clair devient #EBF1F8**, un bleu-gris à la teinte du bleu de la
charte (OKLCH 95,6 % · 0,011 · 252°). Le blanc des blocs s'en détache
nettement (1,14:1) sans que le fond cesse d'être un fond. L'écran de
connexion le suit, par le même jeton. Le thème sombre ne change pas.

**L'entrée courante du menu prend #DBE9FC**, d'un cran plus soutenu que le
bleu pâle de la charte (#E7F1FE), qui se fondait dans le nouveau fond. Elle
s'en détache un peu mieux qu'avant : 1,08:1, contre 1,05:1. Le bleu pâle de
la charte garde ses autres usages ; la nuit, l'entrée garde le bleu profond
de la charte de nuit.

## Conséquences

- Tout ce qui prend le fond de la page le suit (ADR-0116) : le cadre des
  onglets, le corps des fenêtres, les notes posées dans les blocs.
- Les contrastes tiennent : le texte secondaire à 5,5:1 sur le fond, le bleu
  de la charte à 7,3:1, le mot de l'entrée courante à 6,8:1 sur son bleu.
- Le volet public d'une offre d'emploi et les courriels gardent #F3F6FA :
  ils ont leur propre fond, hors de l'application.
