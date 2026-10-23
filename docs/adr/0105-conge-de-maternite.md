# ADR-0105 : Le congé de maternité : la cessation de paiement et la reprise de service

**Statut** : acceptée · 2026-10-18 · précise l'[ADR-0104](0104-reprise-apres-disponibilite.md)

## Contexte

L'APIX a fourni deux modèles d'attestation pour le congé de maternité, dans
la mise en page des autres attestations. La cessation de paiement et
d'activités atteste que le salaire est suspendu à compter du premier jour du
congé, « pour jouissance de ses congés de maternité », le certificat médical
en pièce jointe ; son titre tient sur deux lignes. La reprise de service
atteste le retour, « suite à ses congés de maternité », le jour écrit avec
son jour de la semaine.

## Décision

**Les deux attestations se génèrent depuis un dossier** (ADR-0085), qui
donne le nom et le poste ; la DCH saisit un jour. Pour la cessation, le
premier jour du congé de maternité : la saisie `debut`, intitulée « Saisir
la date de début du congé de maternité ». Pour la reprise de service, le
jour de la reprise : la saisie `reprise` (ADR-0104). Le jour de la semaine
de la reprise s'écrit tout seul : « lundi 5 octobre 2026 ».

**Un dossier au genre masculin est refusé**, en le disant : les modèles
attestent un congé de maternité. Un dossier inactif ou en stage l'est
aussi, comme pour les autres attestations.

**Qui atteste dirige la DCH**, au genre de son dossier ; la place vacante
laisse des pointillés. Les noms et le jour sont en gras, comme sur les
modèles.

**Les coquilles se corrigent** (ADR-0095) : « D'ACTIVITÉS » accentué ; les
accords (« Je soussigné », « Directeur du Capital Humain »).

## Conséquences

- Le titre encadré d'une attestation peut tenir sur plusieurs lignes, que le
  modèle sépare ; le cadre grandit d'autant.
- Une attestation peut porter une pièce jointe sous son texte : « PJ :
  Certificat médical ».
