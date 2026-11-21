# ADR-0190 : Au titre d'une demande, l'identité de l'agent et la date de la demande sont figées

**Statut** : acceptée · 2026-11-07 · précise l'[ADR-0189](0189-lettre-de-demande.md)

## Contexte

La page du document d'une demande (ADR-0189) s'ouvre remplie du dossier de
l'agent et de la date de la demande, et tout s'y corrigeait. Or le document
répond à la demande d'un agent précis, à une date que sa lettre ou son envoi
fixe : la personne qui le génère ne doit pouvoir changer ni l'identité de
l'agent, ni son poste, ni la date de la demande.

## Décision

**Ce que la demande et le dossier donnent est figé, et grisé.** Sur la page
du document d'une demande, ces champs se lisent sans se saisir :

- l'identité : civilité, prénom, nom ; le poste, ou la fonction pour la
  domiciliation ;
- l'affectation, pour un renouvellement ; le type de contrat et sa date de
  début, pour la domiciliation ;
- la date de la demande : celle de la lettre pour une décision, le jour de
  l'envoi pour la domiciliation.

Ils s'affichent sur fond gris, sans astérisque, et le clavier passe de saisie
en saisie sans s'y arrêter. Ce que le dossier ne porte pas, un poste manquant
par exemple, reste à saisir. Le reste de la fiche se renseigne comme avant :
les dates de la disponibilité, les sessions du conseil d'administration, la
banque, le destinataire, le RIB, le salaire.

**Le serveur reprend ces valeurs.** Au titre d'une demande, la fiche reçue
est complétée du dossier et de la date de la demande avant de produire le
document : une autre valeur envoyée à leur place est ignorée. Une fiche qui
nomme une autre personne reste refusée (ADR-0189).

**Pour tous, qui dirige la DCH compris.** Le passage par la demande ne
dépend plus des droits de génération : depuis la page d'une demande, qui
dirige la DCH génère avec les mêmes champs figés. « Générer des documents »,
sans demande, ne change pas : tout s'y saisit et s'y corrige (ADR-0174).

## Conséquences

- `ficheReprise` (contrats) dit ce que la fiche reprend : la page s'en sert
  pour figer ses champs, le serveur pour les reprendre. Les deux ne peuvent
  pas diverger.
- Une date de lettre mal saisie par l'agent ne se corrige plus au
  traitement : la demande se refuse, et l'agent la refait.
- Un dossier incomplet ou faux se corrige dans « Gestion du personnel », pas
  sur la fiche du document.
