# ADR-0061 : Une offre reste ouverte après sa date limite

**Statut** : acceptée · 2026-10-12

## Contexte

Depuis la migration 0067, une offre se fermait d'elle-même le lendemain de sa
date limite : la liste des offres la disait « Archivée », son lien de
candidature disparaissait, et le candidat qui le suivait lisait « La date
limite de candidature est passée : cette offre n'accepte plus de dossiers ».
La DCH veut pouvoir recevoir des candidatures après la date annoncée, et
fermer une offre quand elle le décide.

## Décision

**La date limite ne ferme plus l'offre.** Elle s'annonce au candidat tant
qu'elle est à venir ; passée, l'offre publiée reçoit encore des dossiers, et
son lien se copie toujours depuis la liste des offres. La page de
candidature ne montre plus une date passée.

**Seule la RH ferme une offre, à tout moment**, avec « Archiver », que la
date limite soit passée ou non : son lien ne mène alors plus à rien.
« Rouvrir » la rend aux candidats, même sa date passée.

**Une date limite se fixe à venir**, à la création comme quand on la
change. Celle qui est déjà passée n'empêche ni de modifier l'offre, ni de la
publier, ni de la rouvrir.

**Les offres closes par le système pour leur date limite se rouvrent**
(migration 0105) : au journal, leur dernière clôture n'a pas d'auteur.
Celles que la RH a archivées restent archivées.

## Conséquences

- « Archivée », dans la liste des offres, ne se lit plus que sur une offre
  que la RH a archivée.
- Une date limite passée reste en rouge dans la liste : la RH voit qu'elle
  est dépassée, l'offre reste ouverte.
- Le candidat ne lit plus « La date limite de candidature est passée » ; le
  lien d'une offre archivée dit « Cette offre n'existe pas ou n'est plus
  publiée ».
