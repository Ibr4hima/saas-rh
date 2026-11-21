# ADR-0159 : L'import lit le fichier du personnel de la DCH

**Statut** : acceptée · 2026-11-02

## Contexte

La DCH tient son effectif dans un classeur de soixante colonnes (ADR-0158).
L'import attendait un autre fichier : vingt-trois colonnes, le N+1 désigné
par son matricule, un matricule déjà présent ignoré. Le fichier de la DCH
nomme le N+1 et le responsable fonctionnel par leur nom, place les chefs par
l'intitulé du poste, et porte les erreurs d'un fichier tenu à la main :
« St Louis », « Ziginchor », « non cadre », des dates gardées en nombres par
Excel (44452 pour le 13 septembre 2021), des matricules en double. La DCH va
aussi le renvoyer, corrigé puis complété.

## Décision

**L'import lit le fichier de la DCH tel quel.** Les intitulés se
reconnaissent sans accents ni casse, dans n'importe quel ordre, et sous un
éventuel titre. N°, Nom complet, Âge et Nationalité sont lus sans être
repris : l'âge se calcule, la nationalité se déduit du pays de naissance.
Fils/Fille, la rémunération, la banque et l'IPRES ne sont pas importés ;
l'aperçu les nomme quand ils portent des valeurs.

**Il corrige ce qui ne laisse aucun doute, et le montre.** La région, le
statut, le sexe, la situation matrimoniale, le pays, le lien de parenté et
le type de contrat se ramènent à leur liste, fautes de frappe et
abréviations comprises ; une valeur aussi proche de deux valeurs de la
liste n'est pas devinée. Les noms s'écrivent « Ndeye Fatou Diop », les
téléphones sénégalais avec +221, la CNI en 13 chiffres, l'adresse
professionnelle en @apix.sn. Une date gardée en nombre se lit comme la date
qu'elle est. Sans date d'entrée, l'ancienneté donne le mois et l'année, et
la fiche le marque (ADR-0158). Chaque correction s'affiche dans l'aperçu.

**Seuls le matricule, le prénom, le nom et la date d'entrée bloquent une
ligne.** Ailleurs, la valeur fausse est écartée et signalée, et le reste de
la ligne est importé. Les épouses s'importent pour un homme marié seulement,
autant de noms qu'annoncé ; sinon l'aperçu le signale et les laisse de côté.
Seuls les CDD, avec leur date de fin, et les CDI s'importent.

**Un matricule connu met la fiche à jour.** L'aperçu liste chaque
changement (« Région : Thiès → Dakar ») ; une case vide n'efface rien. Le
prénom et le nom se comparent sans accents ni casse : les accents que la DCH
ajoute sur la fiche restent. Une mutation, un nouveau contrat ou un
renouvellement se font depuis la fiche : l'aperçu les signale sans les
faire. Un matricule déjà porté par une autre personne arrête la ligne.

**Un matricule en double reçoit 50-A, 50-B**, provisoires (ADR-0158). Au
réimport, la ligne qui porte le vrai matricule retrouve sa fiche par le
prénom, le nom et la date de naissance.

**Le poste place l'agent.** « Directeur… » met à la tête de la direction
qu'il nomme, « Directeur général » au sommet, « Chef de département X » et
« Chef de service X » à la tête de l'unité, créée sous la direction quand
l'organigramme ne l'a pas. La désignation suit les règles de l'organigramme,
et ne remplace jamais un responsable en place. Créer une unité et désigner
un responsable demandent l'habilitation à l'organigramme.

**Le N+1 et le responsable fonctionnel se désignent par leur nom**, dans
n'importe quel ordre, avec ou sans civilité. Un nom porté par plusieurs
personnes, ou qui ne se retrouve qu'à une faute près, se départage dans
l'aperçu avant l'import, une fois pour les agents d'une même direction.
Sans N+1 retenu, l'agent relève d'office du responsable de sa direction.

**L'aperçu joue l'import, puis l'annule.** Toutes les écritures se font dans
une seule transaction, chacune avec son point de reprise : une ligne refusée
n'emporte pas les autres. En aperçu, la transaction s'annule à la fin ;
l'aperçu dit donc ce que l'import fera, refus des règles compris.

## Conséquences

- Le fichier type d'avant (vingt-trois colonnes, N+1 par matricule) n'est
  plus lu.
- Le lecteur de classeurs ne laisse plus une cellule vide en balise courte
  avaler la suivante, et garde le numéro des lignes qu'Excel omet : le
  rapport cite la ligne telle que le tableur la montre.
- La création et la modification d'un dossier, et la création d'une unité,
  s'écrivent aussi dans la transaction de l'appelant.
