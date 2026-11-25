# ADR-0191 : Une demande de document se traite seule, en un écran

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0041](0041-remise-en-ligne-en-pdf.md) et [ADR-0189](0189-lettre-de-demande.md)

## Contexte

Dans « Demandes de documents », on cochait une ou plusieurs demandes, puis
« Prévisualiser » ouvrait deux étapes : « Étape 1 sur 2 · Vérification des
informations », puis la mise à disposition. Plusieurs demandes traitées
ensemble mêlaient dans une même fenêtre des agents, des documents et des
remises différents : c'est là que les erreurs arrivent. Et l'étape de
vérification ne montrait qu'un document, l'attestation de travail ; pour
les autres, elle n'avait rien à afficher.

## Décision

**Une demande se traite seule.** La file n'a plus de cases à cocher.
Chaque demande que l'on peut traiter porte, en bout de ligne, « Traiter »
et « Décliner ».

**« Traiter » ouvre directement « Mise à disposition »**, sans étape de
vérification. La fenêtre montre le document demandé, puis, côte à côte, la
remise (en main propre ou en ligne) et le point de retrait. En ligne, le
point de retrait cède la place au document à déposer, sous la remise.
« Précision (facultatif) » disparaît : le point de retrait dit où passer.
Le bouton est « Notifier » en main propre, « Déposer et notifier » en
ligne.

**Le document se prépare depuis la ligne de la demande.** « Générer le
document » y ouvre la page du document (ADR-0189) pour une décision de
disponibilité, un renouvellement ou une domiciliation, et l'attestation de
travail dans la fenêtre d'aperçu, d'où elle s'imprime ou s'enregistre.
« Notifier » ne télécharge plus rien : le document se génère avant de
prévenir l'agent.

**« Décliner » vaut pour une demande** : « Décliner la demande », le
document demandé et le motif du refus, envoyé tel quel à l'agent.

## Conséquences

- `POST /document-requests/batch-advance` garde sa liste d'identifiants :
  l'écran n'en envoie plus qu'un.
- Les textes de l'étape de vérification disparaissent avec elle :
  « Veuillez vérifier l'exactitude des informations demandées auprès du
  service de paie avant de valider. » et « Dossier non actif ».
- La ligne d'une demande ne compte plus les fichiers déposés : la fenêtre
  de mise à disposition les liste.
- La fenêtre d'aperçu donne la raison d'un refus dans les mots de l'API
  (une attestation réservée aux agents en activité, par exemple), et ne
  recharge plus le document à chaque rendu de la page qui l'ouvre.
