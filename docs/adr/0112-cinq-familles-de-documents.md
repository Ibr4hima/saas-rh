# ADR-0112 : La liste des documents à générer en cinq familles

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0111](0111-liste-des-documents-a-generer.md)

## Contexte

La liste des documents à générer gardait les trois familles de sa première
version : « Contrats », « Attestations », « Autres documents ». La dernière
mêlait la domiciliation bancaire, les décisions de disponibilité, la
déclaration de mouvement et le certificat de travail. L'APIX demande cinq
familles.

## Décision

**Cinq familles, dans cet ordre :**

- « Documents contractuels » : les contrats à durée déterminée, à durée
  indéterminée et de stage ;
- « Attestations » : les attestations de congé, de travail, de reprise de
  service, de reprise après disponibilité, de départ à la retraite, de
  stage, de cessation de paiement et d'activités ;
- « Documents de rémunération » : la domiciliation bancaire, puis
  l'attestation de revenu ;
- « Situation administrative du personnel » : la mise en disponibilité, son
  renouvellement, la déclaration de mouvement du travailleur ;
- « Fin de relation professionnelle » : le certificat de travail.

**La liste suit cet ordre, et le clavier aussi.** L'attestation de revenu y
passe après la domiciliation bancaire ; la liste de la DCH garde son ordre
partout ailleurs.

## Conséquences

- Une seule table donne à chaque document sa famille et son libellé. Elle
  est typée sur la liste de la DCH : un document qui y entre demande sa
  ligne.
