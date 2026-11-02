# ADR-0165 : L'administrateur peut vider l'import pour recommencer

**Statut** : acceptée · 2026-11-02

## Contexte

Le premier import du fichier de la DCH sert aussi d'essai : on le lance, on
regarde les fiches, l'organigramme et le tableau de bord, et l'on corrige le
fichier. Recommencer demandait de vider le personnel en ligne de commande
(`pnpm personnel:vider`), ce qui efface tout le personnel, et laisse les
unités que l'import a créées. Il manquait un geste dans l'application, qui
ne retire que ce que l'import a créé.

## Décision

**L'import marque ce qu'il crée** : chaque dossier et chaque unité qu'il
crée le portent (migration 0127). Un import fait avant cette marque la
reçoit aussi : un import crée tout dans une seule transaction, à la même
heure, quand un dossier saisi à la main naît seul dans la sienne. Les
dossiers nés à plusieurs dans la même transaction, et les unités nées avec
eux, viennent donc d'un import.

**« Vider l'import », à côté d'« Importer », est réservé à
l'administrateur**, comme le serveur le vérifie. La fenêtre dit ce qui sera
supprimé et ce qui reste, et demande de taper VIDER.

**Le vidage efface les dossiers que l'import a créés**, actifs ou
inactifs, comme une suppression définitive les efface un à un : contrats,
affectations, rémunération, congés, documents, évaluations, habilitations,
et leur trace dans le journal. Sans les garde-fous d'une suppression à la
main : un responsable ou un N+1 part aussi, et les dossiers saisis à la
main qui en relevaient reviennent au responsable de leur direction. Le
compte d'un agent se ferme ; celui d'un administrateur reste.

**Puis il retire les unités que l'import a créées**, comme l'organigramme
les supprime, sauf celles qui portent encore ce qui a été saisi à la main :
une unité, l'affectation en cours d'un dossier, une offre d'emploi ouverte.

## Conséquences

- Les directions, les unités et les dossiers saisis à la main, les
  réglages, l'Academy et le recrutement restent.
- Les désignations faites après l'import (directeur du Capital Humain,
  délégations) partent avec les dossiers : elles se refont après le nouvel
  import.
- Vider 210 dossiers prend quelques secondes.
- `pnpm personnel:vider` reste pour vider tout le personnel, saisi à la
  main compris.
