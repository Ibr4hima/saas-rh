# ADR-0086 : Les documents de la DCH sur les modèles de l'APIX : sections composées, Google Sans

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0085](0085-generer-des-documents.md)

## Contexte

L'APIX a fourni le modèle officiel de son attestation de travail, un
document Word : en tête, à gauche, le bloc de la République ; à droite, le
numéro de l'acte et la date ; le timbre « Le Directeur Général Adjoint » en
Comic Sans MS ; le titre dans un cadre gris à double filet ; trois
paragraphes ; en pied de page, à droite, le logo, une barre verticale et les
mentions de la société. L'en-tête et le pied de page y sont des images.

La police principale retenue est finalement celle d'apix-e-voting, Google
Sans, et non Arial (ADR-0085).

## Décision

**Ce qui est propre à l'APIX se compose en code**, comme le bloc de la
République d'apix-e-voting : ce bloc, porté tel quel (mêmes lignes, mêmes
corps, mêmes écarts), et le pied de page de chaque page (le logo déposé par
l'exploitant, une barre bleue, les mentions). Il n'y a plus d'image
d'en-tête à déposer.

**Google Sans est la police principale des documents**, comme dans
apix-e-voting. Comic Sans MS sert à ce que les modèles écrivent avec elle,
Comic Relief tenant sa place faute de licence de redistribution. Arimo,
l'équivalent d'Arial, quitte le dépôt.

**L'attestation de travail reprend le modèle**, mot pour mot, en PDF. Le
numéro reste en pointillés, pour être porté à la main ; la date du jour suit
« Dakar, le ». Le corps nomme qui atteste, qui dirige le sommet de
l'organigramme (un blanc à remplir à la main si personne n'y est désigné),
puis l'agent et sa date d'entrée, en gras, enfin sa fonction et son contrat. La
date d'entrée est le début de l'ancienneté (ADR-0083), à défaut l'embauche.
Les accords suivent le genre que porte chaque dossier ; sans genre, les deux
formes, comme sur un formulaire. L'espace sous le texte reste libre pour la
signature et le cachet. Le matricule, la naissance et l'unité, que le modèle
ne porte pas, n'y figurent plus.

**Un stage relève de l'attestation de stage** : l'attestation de travail le
refuse (`documents.stage`).

**La file des documents montre le PDF lui-même**, comme « Générer des
documents » : une recomposition à l'écran ne suivait plus le modèle. La
route qui rendait les textes de l'attestation disparaît.

**La feuille compose elle-même ses paragraphes justifiés** : pdfkit ne
justifie pas une ligne qui change de graisse en cours de route.

## Conséquences

- Chaque modèle suivant reprend l'en-tête, le pied de page et la feuille ;
  il apporte ses textes et, au besoin, un bloc.
- Le pied de page porte le logo déposé (`logo-apix.png`) ; sans lui, la
  barre et les mentions seules.
- Le timbre et la qualité de qui atteste reprennent le modèle tels quels ;
  qui signe en pratique reste à l'APIX.
