# ADR-0113 : Demander un document : la liste de « Générer des documents », à choix multiple

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0044](0044-demander-un-document-en-fenetre.md) et l'[ADR-0111](0111-liste-des-documents-a-generer.md)

## Contexte

« Demander un document » tenait en un bloc dont le « + » ouvrait une
fenêtre : les seize documents en boutons à cocher, côte à côte, et
l'envoi en pied de fenêtre (ADR-0044). « Générer des documents » choisit
désormais son document dans une liste déroulante, en cinq familles, aux
libellés courts (ADR-0111, ADR-0112). L'APIX demande la même liste pour
demander un document, à choix multiple.

## Décision

**La page tient en un bloc, sans fenêtre** : « Sélectionner les documents à
demander », et à droite la liste de « Générer des documents », mêmes
familles, mêmes libellés, même hauteur bornée. On y coche un ou plusieurs
documents : chacun a sa case, et la liste reste ouverte pour le suivant. Le
bouton de la liste nomme un ou deux documents, puis dit leur nombre.

**Un document déjà demandé, et pas encore prêt, se lit sans se cocher** : il
porte « En cours ».

**Ce qui part se relit avant l'envoi**, sous le choix, dans le même bloc :
« Vous demandez 2 documents : … », sous le titre des documents, et le bouton
« Envoyer ma demande ». Après l'envoi, le bloc dit combien de demandes sont
parties et mène au suivi, comme avant.

**Les deux pages partagent la liste**, dans
`components/liste-des-documents.tsx` : un document se choisit pour être
généré, un ou plusieurs se cochent pour être demandés.

## Conséquences

- « Poser une demande » garde son bloc et sa fenêtre ; les deux pages ne
  partagent plus le même bloc.
- La case des listes à choix multiples se partage : le paquet d'interface
  l'exporte.
