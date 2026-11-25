# ADR-0286 : « Fiche transmise pour avis et commentaire » : la section du N+2, sans l'état sur les cartes

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0255](0255-fiches-a-commenter.md)

## Contexte

Sur l'accueil du N+2, la section qui réunit les fiches envoyées par les
N+1 s'appelait « Fiche d'évaluation à commenter », « Fiches… » au pluriel
(ADR-0255). Chaque carte portait, sous l'email professionnel et le N+1, un
repère « Fiche » : « À commenter », « Commentaires en cours »,
« Commentaires transmis » ou « Reprise par le N+1 ». L'APIX change le titre
et retire ce repère.

## Décision

**La section s'appelle « Fiche transmise pour avis et commentaire »**, et
« Fiches transmises pour avis et commentaire » dès qu'il y en a deux.

**Les cartes perdent le repère « Fiche »** : le nom, le poste, l'email
professionnel et le N+1. Où en est la fiche se lit sur sa page, dans ses
étapes.

**Le nombre reste collé au dernier mot du titre.** Sur un téléphone, un
titre long passe à la ligne avec son nombre, qui ne se retrouve plus seul
sur une ligne. « Mon équipe » et « Objectifs [année] de mon équipe », les
autres titres qui portent un nombre, suivent la même règle ; sur un grand
écran, rien ne bouge.

## Conséquences

- Depuis l'accueil, le N+2 ne distingue plus une fiche à commenter d'une
  fiche déjà commentée ou reprise sans l'ouvrir.
- L'API ne change pas : l'accueil renvoie toujours l'état des commentaires,
  qui dit encore si la carte s'ouvre.
