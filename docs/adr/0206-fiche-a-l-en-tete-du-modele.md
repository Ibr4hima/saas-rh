# ADR-0206 : La fiche d'entretien à l'en-tête du modèle, avec le bleu et l'orange de l'APIX

**Statut** : acceptée · 2026-11-18 · révise l'[ADR-0205](0205-fiche-d-entretien-annuel.md)
pour la mise en page du PDF

## Contexte

La DCH valide le contenu de la fiche (ADR-0205) et demande trois changements
au PDF : l'en-tête exactement dans le style du modèle S1/EN05, en mieux
équilibré ; un peu de bleu et d'orange de l'APIX pour faire ressortir les
sections, le tout noir étant trop sévère ; et plus d'air, sans blocs côte à
côte, la première version étant jugée trop condensée.

## Décision

**L'en-tête du modèle, sur chaque page.** Un tableau à trois bandes, comme
celui de la DCH : « DCH » ; le titre de la fiche, en bleu ; puis le bloc de
la République (dessiné, aucune image de l'APIX n'est copiée), la référence de
la fiche (Réf., Version, Date d'application, les deux-points alignés) et
« Page 2 sur 10 », les nombres en gras. Le nom et le matricule de l'agent
s'ajoutent à droite de la bande « DCH » : une feuille détachée se range
d'elle-même. Le grand en-tête de la République et le titre en Anton des
autres documents ne passent pas sur la fiche.

**Le bleu et l'orange par touches.** Le texte reste noir. La couleur va là où
l'œil doit s'arrêter :

| Où                                           | La couleur                                       |
| -------------------------------------------- | ------------------------------------------------ |
| Le numéro d'une section                      | En blanc sur un carré orange                     |
| L'intitulé d'une section, son filet          | Bleu                                             |
| Le numéro d'une sous-section, « OBJECTIF 1 » | Orange                                           |
| Ce que l'agent et le N+1 ont coché ou donné  | Une case cochée ou une lettre, en blanc sur bleu |
| Les puces d'un texte                         | Bleu                                             |
| Le pied de page                              | Les deux barres bleue et orange du modèle        |

L'orange des petits textes est plus soutenu (#B14600) que celui des aplats
(#CA631F), qui n'atteint pas le contraste voulu sur le blanc.

**Plus d'air, une seule colonne.** Le texte passe à 9,5 points, les lignes
des tableaux s'espacent, les sections et les sous-sections aussi. Plus de
blocs côte à côte : l'identification donne la catégorie, puis l'agent, puis
le N+1, l'un sous l'autre ; chaque objectif donne son intitulé, puis
l'auto-évaluation de l'agent, puis l'appréciation du N+1. Les tableaux du
modèle (compétences, plan d'action, objectifs, formations, validation)
gardent leurs colonnes.

**La grille des compétences à l'italienne**, comme dans le modèle : ses
quatre niveaux y prennent la largeur de la page.

**La mise en page tient ses blocs ensemble.** Une section ne commence pas en
bas de page : son titre part avec le début réel de ce qui le suit, mesuré. Un
objectif tient d'un seul tenant sur sa page quand il y tient. Un tableau
d'au plus quatre lignes ne se coupe pas ; un plus long garde au moins deux
lignes de chaque côté d'une coupure, et reprend ses titres de colonnes.

## Conséquences

- La fiche complète d'exemple passe de 6 à 10 pages, la version de l'agent
  de 5 à 9 : le modèle de la DCH en compte 10.
- Le pied de page commun des documents de la DCH sait se caler sur une page à
  l'italienne ; les autres documents ne changent pas.
- Le reste de l'ADR-0205 tient : le texte corrigé, les deux versions, la
  partie réservée sur une page à part, « Néant » pour un champ vide.
