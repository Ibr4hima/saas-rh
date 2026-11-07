# ADR-0030 : Les candidatures non retenues ont leur page

**Statut** : acceptée · 2026-10-07

## Contexte

Depuis 0029, une candidature rejetée restait parmi les dossiers de son
offre, avec un badge « Rejetée ». Les dossiers à trier se mêlaient à ceux
qui avaient déjà leur réponse.

## Décision

**Rejetée, la candidature quitte son offre.** La liste d'une offre et son
nombre de postulants ne comptent que les dossiers en lice.

**Une page « Candidatures non retenues »**, sous « Dossiers de candidature »,
pour qui lit les dossiers. Un tableau, la plus récente d'abord : nom,
poste, référence et date de l'offre, et « Consulter », qui ouvre le dossier
comme ailleurs (CV, lettre de motivation). Sa lecture se trace comme celle
d'une offre : une ligne par offre dont on a vu les dossiers.

**L'entrée du menu n'existe qu'à partir d'une candidature non retenue.** Le
menu demande leur nombre (`GET /applications/rejected/count`), qui ne
déchiffre ni ne trace rien.

**Le courriel de refus** nomme la raison sociale, « APIX S.A », comme le
corps des actes, et non le nom court de l'organisation.

## Conséquences

- La carte d'un dossier ne porte plus de badge « Rejetée » : elle n'est
  plus jamais sur la page de l'offre. La fenêtre du dossier dit
  « Candidature non retenue ».
- Le geste reste « Rejeter » ; ce qu'on en garde se dit « non retenue ».
- La fenêtre du dossier est partagée par les deux pages
  (`components/fenetre-candidat.tsx`).
