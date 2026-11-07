# ADR-0121 : Générer des documents : un seul bloc « Préremplissage », validé avant la génération

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0087](0087-attestation-de-revenu.md), l'[ADR-0094](0094-contrat-de-stage.md) et l'[ADR-0096](0096-fiche-du-contrat-de-stage.md)

## Contexte

Sous le choix du document, « Générer des documents » posait un bloc par
saisie : le choix de l'agent, puis un bloc par date ou par montant ; pour un
document sans agent, un bloc par partie de la fiche (« Renseigner l'état
civil », « Renseigner l'emploi »…). Le document se générait de lui-même dès
que tout était saisi, et suivait chaque correction une fois la frappe posée
(ADR-0087, ADR-0094, ADR-0096). L'APIX veut un seul bloc de saisie, et une
génération qu'on décide.

## Décision

**Tout ce que la DCH saisit tient dans un seul bloc, « Préremplissage »**,
sous celui du choix du document : une section par partie, selon le
document. Pour un document sans agent, les sections de sa fiche ; pour les
autres, « Sélectionner l'agent », puis, si le document en demande, la
section de ses saisies (« Renseigner le congé », « Renseigner le
salaire »…), chaque champ sous son intitulé.

**Le document ne se génère qu'à « Valider »**, au pied du bloc. Le bouton
s'ouvre quand tout est saisi : la fiche complète, ou l'agent et chacune de
ses saisies.

**Validé, le bloc se replie** à la hauteur de celui du choix du document,
son intitulé à gauche et « Modifier » à droite ; sur téléphone, comme ce
bloc, l'intitulé au-dessus et le bouton sur toute la largeur. Le document
vient dessous, et « Télécharger » dans l'en-tête.

**« Modifier » rouvre le bloc** sur ce qui avait été saisi. Le document et
« Télécharger » se retirent jusqu'à la validation suivante : on ne garde pas
à l'écran un document qui ne dit plus ce qu'on saisit. Choisir un autre
document rouvre le bloc de même.

## Conséquences

- Le document ne suit plus la frappe : il dit exactement ce qui a été
  validé.
- Les sections des fiches gardent leurs champs et leurs règles (tout
  obligatoire, capitales initiales, CNI groupée).
