# ADR-0283 : La case de l'entretien ne parle plus des objectifs, et la section 8.4 disparaît

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0208](0208-fiche-d-entretien-vierge.md), l'[ADR-0209](0209-paraphes-sur-la-fiche-d-entretien.md) et l'[ADR-0265](0265-entretien-confirme-et-date.md)

## Contexte

Au bout de son évaluation, le N+1 coche : « Je confirme avoir eu un
entretien avec Awa Diop pour échanger sur son auto-évaluation et ses
objectifs. » (ADR-0265). Depuis l'ADR-0272, l'évaluation ne fixe plus les
objectifs de l'année suivante : ils ont leur propre campagne (ADR-0274).
La phrase en parlait encore.

La partie réservée de la fiche finissait par une section 8.4,
« Commentaires des autres niveaux hiérarchiques » : des lignes à remplir à
la main, sur la place restant en bas de la dernière page (ADR-0209). Rien
ne la remplissait dans le portail. L'APIX la retire.

## Décision

**La case dit** : « Je confirme avoir eu un entretien avec Awa Diop pour
échanger sur son évaluation. » Le reste ne change pas : le nom est celui de
l'agent, la case est obligatoire et ouvre « Date de l'entretien ».

**La section 8.4 disparaît** de la fiche complète et de la fiche vierge. La
partie réservée s'arrête aux commentaires du N+2 (8.3) et à leur
signature ; la diffusion suit directement.

## Conséquences

- Un PDF déjà téléchargé garde sa section 8.4. Un PDF tiré maintenant, même
  d'une fiche déjà transmise, n'en a plus.
- La dernière page de la fiche vierge perd ses lignes à remplir : elle finit
  sur les commentaires du N+2 et la diffusion.
- Pas de migration, et l'API ne change pas : la confirmation garde son champ,
  `entretienConfirme`.
