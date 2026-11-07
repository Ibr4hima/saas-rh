# ADR-0085 : Générer des documents : qui dirige la DCH, à sa guise, sur les modèles de l'APIX

**Statut** : acceptée · 2026-10-17 · précise l'[ADR-0012](0012-arbitrages-direction-capital-humain.md) et l'[ADR-0084](0084-documents-de-la-dch.md)

## Contexte

L'application ne générait que l'attestation de travail, et seulement pour
une demande ouverte, depuis la file des documents (ADR-0012, ADR-0084). Les
quinze autres documents de la liste de la DCH se préparaient hors de
l'outil. La DCH veut générer tout document de sa liste quand elle le juge
utile, sans attendre de demande ; l'APIX a, pour chacun, un modèle exact,
qu'elle fournira un par un.

Ses modèles sont en Arial, certains en Comic Sans MS.

## Décision

**Une page « Générer des documents », dans l'espace de gestion, pour qui
dirige la DCH.** On y choisit un document de la liste et un agent, en
activité ou non ; la page montre le document tel qu'il sortira, l'ouvre dans
la visionneuse du navigateur pour l'imprimer, ou l'enregistre. Aucune
demande n'est nécessaire. Personne ne génère pour soi. Les membres de la DCH
génèrent toujours pour une demande dont le traitement leur revient, depuis
la file ; le compte d'administration, technique, ne produit pas d'actes
depuis cette page.

**Un document se génère quand son modèle est configuré.** Les seize
documents figurent dans la page, dans l'ordre de la liste ; ceux dont le
modèle reste à venir s'y lisent sans s'ouvrir, et l'API les refuse
(`documents.modele_a_configurer`). Les modèles se configurent un par un,
d'après ceux de l'APIX. La liste des documents générables (`GENERATED_DOCS`,
dans les contrats) et celle des modèles (dans l'API) se tiennent par le
typage : l'une ne compile pas sans l'autre.

**L'aperçu est le PDF lui-même**, lu par le lecteur pdf.js du produit, et
non une recomposition à l'écran : un modèle exact se vérifie sur ce qui
sortira, en-tête et police compris.

**Les documents de la DCH sont en Arial.** Arial et Comic Sans MS ne se
redistribuent pas : le dépôt porte leurs équivalents libres, Arimo et Comic
Relief (licence OFL), dessinés aux mêmes chasses ; un mot y occupe la
largeur qu'il a dans le modèle Word. Les fichiers d'origine, si
l'organisation en a la licence, se déposent dans `apps/api/assets/` et
passent devant, sans être versionnés. Google Sans reste aux certificats de
l'Academy.

**Les modèles s'écrivent sur une feuille commune** (`documents/feuille.ts`),
sur la mécanique des documents d'apix-e-voting : une A4 à l'en-tête de
l'APIX, des blocs qui passent à la page suivante quand ils ne tiennent plus.
Un bloc s'ajoute quand un modèle le demande.

## Conséquences

- L'attestation de travail passe en Arial, dans la file comme dans la page ;
  son texte ne change pas.
- La file des documents garde ses droits et son aperçu ; elle s'ouvrira aux
  modèles suivants à mesure qu'ils seront configurés.
- Un document qui demande ce que le dossier ne porte pas (une date de
  reprise, un montant) recevra ses champs à la configuration de son modèle.
- Aucun registre des documents générés n'est tenu.
- Le refus d'une attestation pour un dossier inactif dit désormais
  « Attestation réservée aux agents en activité ».
