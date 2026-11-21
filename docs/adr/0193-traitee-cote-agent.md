# ADR-0193 : Côté agent, une demande traitée sans filet, sans « Nouveau », sans lettre

**Statut** : acceptée · 2026-11-07 · précise les [ADR-0048](0048-nouvellement-traitees-en-evidence.md) et [ADR-0189](0189-lettre-de-demande.md)

## Contexte

Quand on arrive par l'avis dans « Suivi de mes demandes », la demande
nouvellement traitée se teintait de bleu, se bordait d'un filet à gauche et
portait « Nouveau » (ADR-0048) ; une demande accompagnée d'une lettre montrait
aussi « Lettre de demande » (ADR-0189). C'était beaucoup pour une seule
ligne. Et l'avis d'une disponibilité prête annonçait « Votre décision de
mise en disponibilité est déposée dans votre espace », avant même que
l'agent l'ait lue.

## Décision

**La ligne nouvellement traitée garde sa teinte et son éclairage à
l'arrivée**, sans filet ni « Nouveau ».

**Le suivi de l'agent ne montre plus la lettre de demande.** Qui traite la
demande la lit toujours dans la file et sur la page du document.

**L'avis d'une disponibilité ou d'un renouvellement prêt dit que la
demande est traitée** : « Votre demande de disponibilité a été traitée »,
« Votre demande de renouvellement de disponibilité a été traitée ». En main
propre, il ajoute où retirer la décision : « …, la décision à retirer
auprès de … » ; en ligne avec un original à retirer, « …, l'original de la
décision à retirer auprès de … ». Le courriel reprend l'avis. Les autres
documents gardent leurs avis.

## Conséquences

- L'agent garde l'accès à sa lettre par l'API (ADR-0189) ; l'écran ne la
  propose plus.
- Un dépôt de plus sur une décision déjà prête renvoie le même avis.
