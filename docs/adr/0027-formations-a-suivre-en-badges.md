# ADR-0027 : Les formations à suivre en badges, atteintes au certificat

**Statut** : acceptée · 2026-10-07

Remplace le point 2 de la décision de l'[ADR-0026](0026-fiche-objectifs-en-trois-parties.md).

## Contexte

L'ADR-0026 listait tout le catalogue de l'APIX Academy sous les objectifs,
une ligne par formation, avec son état (« En cours », « Pas commencée ») et
les formations déjà obtenues grisées. La liste était longue, et ce qui comptait
pour le n+1, les formations qui restent à obtenir, s'y perdait. La règle du
statut, elle, donnait « partiellement » dès la première leçon vue.

## Décision

**Des badges, sur une ligne.** Le n+1 voit en badges les formations que
l'agent n'a pas obtenues, commencées ou non, sans leur état. Un clic en
demande une, un second la retire. Une formation obtenue n'est plus proposée.
L'agent lit en badges celles qui lui sont demandées ; chacune mène à sa page.

**Le statut d'une formation demandée**, lu dans l'APIX Academy :

| Statut        | Quand                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Atteint       | certificat obtenu, ou toutes les leçons vues quand la formation n'a pas d'évaluation                                         |
| Partiellement | la moitié des leçons vues au moins, sans l'avoir obtenue (évaluation pas réussie, ou leçons pas toutes vues sans évaluation) |
| Non atteint   | moins de la moitié des leçons vues                                                                                           |

La part vue se mesure en leçons validées sur le nombre de leçons.

**Pas de commentaire sur une formation.** Ni l'agent dans son
auto-évaluation, ni le n+1 dans son évaluation : le statut vient de l'Academy.

## Conséquences

- Rien ne change en base : les blocs `formation` du contenu restent la liste
  des formations demandées.
- Une formation demandée puis obtenue reste dans la fiche, atteinte, mais
  n'apparaît plus parmi les badges du n+1 : il ne peut plus la retirer.
- Une fiche envoyée fige la progression de l'agent (leçons vues, certificat),
  pas le statut : la règle s'applique à la lecture. Une formation commencée
  mais vue à moins de la moitié, dans une fiche envoyée avant ce changement,
  se lit désormais « non atteint » au lieu de « partiellement ».
