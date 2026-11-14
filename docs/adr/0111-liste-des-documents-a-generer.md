# ADR-0111 : La liste des documents à générer : des libellés courts, une hauteur bornée

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0085](0085-generer-des-documents.md)

## Contexte

Sur « Générer des documents », la liste déroulante des documents descendait
jusqu'au bas de l'écran, et au-delà. Chaque ligne portait une pastille
ronde à gauche, loin de la barre de défilement, et le titre complet du
document : « Contrat de travail à durée déterminée », « Attestation de
reprise après disponibilité ». L'APIX demande une hauteur adéquate, une
liste mieux ordonnée et des libellés plus courts, sans rien changer aux
documents.

## Décision

**La liste a ses propres libellés, plus courts** : « Contrat à durée
déterminée », « Contrat à durée indéterminée », « Contrat de stage »,
« Attestation de congé », « Attestation de travail », « Reprise de service ·
Maternité », « Reprise après disponibilité », « Départ à la retraite »,
« Attestation de stage », « Cessation de paiement et d'activités »,
« Attestation de revenu », « Domiciliation bancaire », « Mise en
disponibilité », « Renouvellement de disponibilité », « Déclaration de
mouvement du travailleur », « Certificat de travail ». Le bouton de la liste
montre le même libellé. Le document garde son titre : dans l'aperçu, dans le
fichier et partout ailleurs. L'ordre et les familles ne changent pas.

**La liste a une hauteur bornée et défile à l'intérieur** : sept ou huit
lignes, jamais plus que l'écran. La barre de défilement longe le bord du
panneau, les lignes gardent leur marge.

**Elle se lit comme les autres listes de l'application** : le document
choisi en bleu, coché à droite ; la ligne survolée sur un fond gris ; les
familles en petites capitales, séparées d'un filet. La liste des agents prend
la même marge et une hauteur bornée.

## Conséquences

- Un document ajouté à la liste de la DCH demande son libellé court : la
  table des libellés est typée sur la liste.
