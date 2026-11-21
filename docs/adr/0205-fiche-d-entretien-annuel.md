# ADR-0205 : La fiche d'entretien annuel d'évaluation S1/EN05, son texte corrigé et son PDF

**Statut** : acceptée · 2026-11-18 · révise l'[ADR-0149](0149-evaluation-sur-la-grille-de-l-apix.md)
et l'[ADR-0151](0151-paraphes-et-notes-au-dossier.md), remplace l'[ADR-0155](0155-grille-du-personnel-non-cadre.md)
pour les campagnes à venir

## Contexte

La DCH remplace ses deux grilles, celle du personnel cadre (S1/EN02) et celle
du personnel non cadre, par une seule fiche : la « Fiche d'entretien annuel
d'évaluation » (réf. S1/EN05, version 02). La campagne 2026 se fait sur elle,
du 15 au 30 décembre : l'agent commence par son auto-évaluation, le N+1
complète la fiche après l'entretien. La DCH laisse corriger le texte de la
grille, et demande un PDF très soigné.

## Décision

**Une seule fiche, une seule source.** Le texte de la fiche (sections,
questions, compétences et leurs niveaux, échelles) vit dans les contrats
(`entretien-annuel.ts`) : les écrans et le PDF le lisent au même endroit.

**Le texte de la grille, corrigé.** Les fautes (« HIERACHIE »,
« Comprehension », « Connait », « ÉVALUATION DES ET PERFORMANCES »), les
majuscules en milieu de titre, et les accords qui supposaient un genre à la
personne évaluée (« encouragé », « débordé », « assidu et ponctuelle »,
« partisan du laisser-faire ») : chaque descripteur se réécrit sans accord,
sans changer ce qu'il dit. Les années s'écrivent en chiffres : « Bilan de
l'année 2026 », « Les objectifs de l'année 2027 ». « N+1 » ne désigne plus
que le supérieur hiérarchique.

**Ce qui change par rapport à la grille.**

| Où                     | La fiche                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Les objectifs          | Les quatre niveaux de la grille ; deux appréciations côte à côte, celle de l'agent et celle du N+1 |
| Le management          | Le personnel cadre seulement, « si applicable » : sans niveau, il s'imprime « Sans objet »         |
| La note                | Le niveau donné est la note : la consigne « indiquer la note attribuée » disparaît                 |
| Le récapitulatif 2.1   | Rempli par l'agent, comme le disait sa colonne                                                     |
| Les signatures         | Chaque validation faite dans le portail s'imprime « Validation en ligne », avec sa date            |
| Les autres hiérarchies | Leurs commentaires restent à écrire à la main sur l'original                                       |

Les paraphes à la main de l'ADR-0151 ne passent pas sur la fiche : une
écriture qui imite des initiales se confondrait avec une vraie signature.

**Le PDF.** A4, sur le papier des documents de la DCH (ADR-0203) :
l'en-tête de la République sur la première page, les mentions de la société
en pied de chaque page, tout à l'encre noire. Raleway aux chiffres alignés,
Anton pour le titre, souligné d'un court filet.

- Des tableaux à filets horizontaux seulement, sans cadre ni fond : un trait
  fort en haut et en bas, un trait fin entre les lignes.
- À partir de la deuxième page, un bandeau rappelle la fiche, sa référence,
  l'agent et son matricule ; chaque page dit « Page 2 sur 6 ».
- Une section ne commence pas en bas de page ; une ligne de tableau ne se
  coupe pas ; un tableau qui passe à la page suivante y reprend ses titres de
  colonnes.
- Un champ vide s'imprime « Néant ». Une ligne qui commence par un tiret
  devient une puce.
- La typographie française : l'apostrophe courbe, l'espace insécable avant
  les deux-points, le point-virgule, les points d'interrogation et
  d'exclamation, et dans les guillemets.

**Deux versions.** Celle de l'agent, sections 1 à 7. La version complète
ajoute la partie strictement réservée à la hiérarchie (section 8), toujours
sur une page à part : elle se détache de l'original.

## Conséquences

- La référence, la version et la date d'application de la fiche restent
  celles de la DCH (S1/EN05, 02, 15 décembre 2018) ; elles se changent à un
  seul endroit.
- Le parcours de la fiche (auto-évaluation, entretien, évaluation du N+1,
  validation de l'agent, N+2, DCH), l'import des objectifs 2026 par la DCH
  et les écrans font l'objet d'une décision à part.
- Les grilles S1/EN02 et du personnel non cadre restent lisibles pour les
  années passées.
