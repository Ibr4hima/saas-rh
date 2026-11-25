# ADR-0289 : Campagne : le N+2 de l'envoi garde la fiche, l'évaluateur se fige, chaque geste revérifié

**Statut** : acceptée · 2026-11-25 · révise l'[ADR-0218](0218-commentaires-du-n2.md), l'[ADR-0221](0221-transmission-a-la-dch.md), l'[ADR-0222](0222-administration-de-la-campagne.md), l'[ADR-0241](0241-valider-l-auto-evaluation.md), l'[ADR-0255](0255-fiches-a-commenter.md), l'[ADR-0260](0260-valider-l-evaluation-du-n1.md), l'[ADR-0278](0278-envoi-simultane-a-l-agent-et-au-n2.md) et l'[ADR-0279](0279-telechargement-par-le-n1-et-le-n2.md)

## Contexte

L'audit du 25 novembre 2026 a relu la campagne d'évaluation de bout en
bout. Plusieurs règles se recalculaient à chaque lecture, alors qu'elles
auraient dû se figer au moment du geste.

- **Le N+2** se recalculait à chaque lecture : l'évaluateur de
  l'évaluateur. Après un changement d'organigramme ou d'évaluateur, une
  fiche envoyée passait, partie réservée comprise, à quelqu'un qui ne
  l'avait jamais reçue, et quittait la personne qui l'avait reçue.
- **Une fiche transmise à la DCH** suivait encore le N+1 de
  l'organigramme : un changement la faisait passer dans l'équipe d'un
  autre N+1, qui la lisait en entier. L'ADR-0222 promettait le contraire.
- **Le PDF** imprimait comme signataire le N+1 d'aujourd'hui, et rien
  quand la personne avait quitté l'APIX.
- **Un membre de la DCH** lisait sa propre fiche dans le suivi, partie
  réservée et commentaires du N+2 compris : ce que l'agent ne lit jamais
  (ADR-0268).
- **Deux gestes qui se croisaient** (deux onglets, un double clic, la
  remise à zéro pendant une saisie) passaient tous les deux, ou le second
  répondait « fait » sans rien écrire.
- **Les aperçus en PDF** (« Valider ») restaient ouverts après la
  transmission : on imprimait une fiche à l'en-tête officiel avec
  n'importe quel contenu.

## Décision

**Le N+2 se garde à l'envoi.** La transmission de l'évaluation avec
« Envoyer aussi la fiche au N+2 » enregistre ce N+2
(`fiches_entretien.envoyee_n2_a`, migration 0149). C'est ce N+2 qui trouve
la fiche dans « Fiche transmise pour commentaire », la lit, la télécharge
et la commente, quoi que devienne l'organigramme ensuite. Avant l'envoi, le
N+2 d'aujourd'hui voit seulement où en est la fiche. Le N+1, la DCH et le
PDF nomment le N+2 de l'envoi. Les fiches déjà envoyées prennent le N+2
qui a commenté, sinon le N+2 que la lecture trouvait ; une fiche marquée
envoyée alors qu'elle n'avait pas de N+2 (la règle d'avant l'ADR-0278)
redevient non envoyée.

**L'évaluateur se fige à la transmission à la DCH** : la fiche reste au
N+1 qui l'a transmise.

**La signature du N+1** revient à la personne qui a transmis l'évaluation
à l'agent, avec son poste de ce jour-là, sur l'écran de la DCH comme sur
les PDF.
Les signatures du N+2 et de la transmission à la DCH portent aussi le
poste du jour de leur geste.

**Sa propre fiche ne s'ouvre pas depuis le suivi** : `403
campagne.sa_propre_fiche`, et sa ligne n'a pas de lien (`ouvrable`).

**Chaque écriture revérifie ses conditions sous le verrou de la ligne** :
l'auto-évaluation, l'évaluation, la validation par l'agent, les
commentaires du N+2, la reprise, la transmission à la DCH et le choix de
l'évaluateur. Le second de deux gestes qui se croisent reçoit le même
refus que s'il était arrivé après (« Évaluation déjà transmise »,
« Commentaires déjà transmis »…) ; sans refus plus précis, `409
campagne.fiche_modifiee`, « La fiche vient de changer ». Les commentaires
du N+2 ne s'écrivent plus sur une fiche transmise à la DCH.

**L'aperçu en PDF** obéit aux conditions de l'écriture : transmise, ou la
période passée, la saisie ne se prévisualise plus ; le PDF de la fiche est
celui qui se télécharge.

## Conséquences

- Un changement d'organigramme pendant la campagne ne déplace plus que ce
  qui n'est pas encore parti.
- La remise à zéro efface aussi le N+2 de l'envoi.
- Ces règles sont couvertes par les tests de la campagne, dont deux envois
  simultanés.
