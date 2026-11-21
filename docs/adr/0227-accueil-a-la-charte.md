# ADR-0227 : L'accueil de la campagne à la charte de l'APIX

**Statut** : acceptée · 2026-11-21 · révise les ADR [0211](0211-mode-campagne-et-accueil.md), [0214](0214-bouton-m-auto-evaluer.md), [0220](0220-periode-d-evaluation-sur-l-accueil.md), [0221](0221-transmission-a-la-dch.md) et [0222](0222-administration-de-la-campagne.md)

## Contexte

L'accueil de la campagne (ADR-0211) posait ses blocs les uns sous les
autres : des cartes blanches, des titres discrets. Propre, mais rien n'y
disait l'APIX. La charte graphique de l'APIX (V1, septembre 2026) a été
fournie avec la demande d'une refonte complète de l'accueil : rester simple,
mais nettement plus soigné, et dans l'esprit de la charte.

La charte retient le bleu #004F91 et l'orange #CA631F, trois polices (Anton
pour les titres, Exo, Raleway), des icônes linéaires en orange, la courbe du
papier à en-tête et des ondulations sur fond bleu. L'application en avait
déjà les couleurs, les trois polices pour les courriels (ADR-0186), et sur
l'écran de connexion la courbe soulignée d'orange et les ondulations
(ADR-0187).

## Décision

**Le bandeau.** En tête, la personne, sur le bleu de la charte en dégradé,
avec les ondulations de la page de garde à droite : ses initiales dans un
rond, son nom, son poste. À droite, le bouton du moment, « M'auto-évaluer »
puis « Valider mon évaluation », en blanc, le mot en bleu ; sur un
téléphone, il prend la largeur du bandeau. Le bleu s'arrête sur la courbe
du papier à en-tête, soulignée d'orange ; dessous, sur le blanc, les
repères de la fiche, inchangés : direction, département, service ou email
professionnel, supérieur hiérarchique, statut.

**Les titres de section** sont en Anton, en capitales, dans le bleu de la
charte, soulignés d'un filet orange comme le titre de la connexion :
« Période d'évaluation annuelle · 2026 », « Mon équipe », « Commentaires du
N+2 ». Le nombre d'agents suit le titre, dans une pastille.

**La période.** Ses deux temps sont numérotés « 01 » et « 02 », en Anton
orange, comme le sommaire de la charte. Chacun garde son titre, sa coche
bleue une fois fait, sa période, ses trois puces et son lien.

**Le pilotage.** Le suivi de la DCH et l'administration deviennent des
tuiles, juste sous le bandeau : l'icône en orange, comme l'iconographie de
la charte, le titre, la même ligne qu'avant, et pour le suivi la jauge des
fiches transmises. Seule, une tuile prend toute la largeur et tient sur une
ligne.

**Les cartes des agents** gardent leur contenu et leur point (ADR-0226),
avec des initiales plus grandes et plus d'air. Dans « Mon équipe », le titre
de chaque groupe porte la pastille de sa couleur : il sert de légende aux
points des cartes.

**Un compte sans dossier d'agent**, l'administration, a lui aussi son
bandeau : les deux temps de la campagne et leurs dates, numérotés. La barre
en dit déjà le titre ; il ne se lit dans la page que par les lecteurs
d'écran.

À l'arrivée sur la page, les blocs montent de quelques pixels l'un après
l'autre, comme sur la connexion ; rien ne bouge quand le système demande
moins d'animations. La nuit, le bandeau reste bleu, un cran plus sombre.

## Conséquences

- L'application sert Anton (`font-titre`) depuis les fichiers déjà là pour
  les courriels. Exo et Raleway restent aux courriels, Google Sans au reste
  de l'interface.
- Le bandeau a ses jetons, `--tg-bandeau` et `--tg-bandeau-fin`, de jour et
  de nuit.
- La grille des repères (`GrilleDeReperes`) et les repères d'un agent
  (`reperesDeLAgent`) sont partagés entre l'en-tête des pages et le
  bandeau : les autres pages de la campagne ne changent pas.
- Les tuiles passent avant la période : pour qui pilote la campagne, ce sont
  les pages de tous les jours.
