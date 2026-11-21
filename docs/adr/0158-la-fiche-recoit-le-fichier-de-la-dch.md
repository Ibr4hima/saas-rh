# ADR-0158 : La fiche reçoit tout ce que la DCH tient sur chaque agent

**Statut** : acceptée · 2026-11-02

## Contexte

La DCH tient son effectif dans un classeur de soixante colonnes. La fiche
d'un agent n'en recevait qu'une vingtaine. Il manquait la ville de
naissance, la filiation, les épouses, les enfants, la ville et la région, le
lien avec la personne à contacter en cas d'urgence, le lieu de travail, le
projet, la catégorie socio-professionnelle, le responsable fonctionnel, la
rémunération, la banque et l'IPRES. L'import du classeur (ADR-0159) n'avait
donc nulle part où les écrire.

## Décision

**La fiche reçoit toutes ces informations**, à la création, à la
modification et à l'import. Elles s'affichent sur la fiche, dans les groupes
Identité, Famille, Coordonnées et Personne à contacter en cas d'urgence, et
dans les cartes Emploi et Rémunération.

**Les règles de la DCH :**

- Les épouses se déclarent pour un homme marié seulement, quatre au plus,
  un nom par épouse : le nombre d'épouses est celui des noms.
- Le nombre d'enfants est vide, ou positif.
- La région est l'une des quatorze régions du Sénégal.
- Le lien de parenté est Père, Mère, Conjoint(e), Frère, Sœur, Enfant,
  Ami(e) ou Autre.
- La CNI compte 13 chiffres ; elle se garde en chiffres seuls.
- Un numéro sénégalais compte 9 chiffres après le +221, et commence par 7
  ou 3. Un numéro d'un autre pays suit ses propres règles.
- L'adresse professionnelle se termine par @apix.sn. Le domaine est une
  seule valeur, partagée par l'écran et le serveur, tant que le produit sert
  un seul employeur.

**La filiation** reprend les champs du contrat de stage : le prénom du père,
le prénom et le nom de la mère. Le contenu de la colonne « Fils/Fille » du
classeur reste à confirmer avec la DCH ; l'import ne la lit pas encore.

**Le responsable fonctionnel est une information.** Les congés,
l'évaluation et la chaîne hiérarchique ne connaissent que le N+1 (ADR-0148) :
seul le N+1 valide. Le responsable fonctionnel est un agent en activité,
jamais l'agent dont c'est la fiche.

**La rémunération, la banque, le RIB et l'IPRES sont réservés à l'accès aux
données sensibles**, comme le numéro de la pièce d'identité. Ils vivent à
part, pour ne jamais partir avec le reste de la fiche, et le RIB est chiffré.
L'agent ne les voit pas sur sa propre fiche.

**L'âge se calcule** depuis la date de naissance, et la nationalité se lit
au pays de naissance : le classeur les porte, l'application ne les recopie
pas.

**Deux marques viennent de l'import :**

- un matricule provisoire (50-A, 50-B, pour un matricule en double dans le
  classeur), qui se corrige sans le délai de trente jours ;
- une date d'entrée connue au mois seulement, quand le classeur ne donne que
  l'ancienneté. La fiche l'affiche au mois (« sept. 2021 ») ; une attestation
  ou un certificat attend que la DCH précise le jour, plutôt que d'imprimer
  un 1er du mois qui n'a pas eu lieu.

## Conséquences

- Migration 0126 : les colonnes de la personne et de l'emploi, et la table
  `remunerations`.
- Les règles s'appliquent à la saisie : les numéros déjà enregistrés ne sont
  pas revérifiés tant qu'on ne les modifie pas.
- Une modification qui laisserait des épouses à une femme, ou à un homme qui
  n'est plus marié, est refusée tant qu'elles ne sont pas retirées ; le
  formulaire les retire de lui-même.
