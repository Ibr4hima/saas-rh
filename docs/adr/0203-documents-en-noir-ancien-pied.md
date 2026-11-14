# ADR-0203 : Les documents de la DCH en noir, l'ancien pied de page de l'APIX remis au propre

**Statut** : acceptée · 2026-11-14 · révise l'[ADR-0173](0173-papier-de-la-charte.md)

## Contexte

Les documents de la DCH suivaient la charte de l'APIX de 2026
([ADR-0173](0173-papier-de-la-charte.md)) : le titre d'un acte en capitales
bleues souligné d'un filet orange, une courbe bleue en pied de page, et les
mentions de la société en trois colonnes avec leurs pictogrammes. La DCH
garde ce style, mais le veut en noir, plus administratif. Elle veut aussi
retrouver l'ancien pied de page de l'APIX, un bloc de mentions en bas à
droite derrière un filet, sans le logo qui l'accompagnait.

## Décision

**Les documents s'impriment en noir.** Le titre d'un acte reste en Anton,
en capitales, centré et souligné d'un court filet, l'un et l'autre en noir.
Les pointillés du numéro, le pied de page et le numéro de page aussi. Seul
le drapeau du Sénégal garde ses couleurs ; le logo de l'en-tête reste le
fichier que l'APIX dépose.

**Le pied de page reprend l'ancien papier de l'APIX, remis au propre.** En
bas à droite, six lignes en Exo, alignées à gauche derrière un filet
vertical très fin, le bloc calé sur le bord droit du logo :

- Société Anonyme à Participation Publique Majoritaire
- au Capital de 4.950.000.000 FCFA
- RCCM : SN DKR 2008 B 72 · NINEA : 28409592G3
- 52-54, rue Mohamed V · BP 430 - CP 18524 Dakar SENEGAL
- Tél. (+221) 33 849 05 55 · Fax (+221) 33 823 94 89
- infos@apix.sn · www.investinsenegal.sn

Un point sépare deux mentions d'une même ligne. Le logo de l'ancien pied ne
revient pas. Le numéro de page d'un document de plusieurs pages (« 2/4 »)
passe en bas à gauche, sur la ligne de la dernière mention.

**La mise en page des actes ne bouge pas.** Le texte d'une page s'arrête
toujours là où il s'arrêtait au-dessus de la courbe : chaque document garde
son nombre de pages. Les blocs posés en bas à gauche, les ampliations d'une
décision et le destinataire d'une domiciliation, s'arrêtent au-dessus du
pied, à quelques points de leur place d'avant.

## Conséquences

- La courbe et les pictogrammes quittent les documents, et leur police,
  Material Symbols, quitte `apps/api/assets/fonts/`.
- « Tél. » prend son accent ; le courriel se lit sans « mail : » devant.
- Le certificat d'APIX Academy, les courriels et l'interface gardent les
  couleurs de la charte. La déclaration de mouvement, formulaire de
  l'administration sans le pied de l'APIX, ne change pas.
- Un test vérifie que l'attestation de travail, la décision de mise en
  disponibilité, la domiciliation bancaire et le contrat de travail
  n'emploient que le noir et les couleurs du drapeau.
