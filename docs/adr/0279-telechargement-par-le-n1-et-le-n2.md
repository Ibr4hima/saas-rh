# ADR-0279 : Le N+1 et le N+2 téléchargent aussi la fiche complète en PDF

**Statut** : acceptée · 2026-11-25 · complète l'[ADR-0221](0221-transmission-a-la-dch.md), l'[ADR-0268](0268-telechargement-par-l-agent.md) et l'[ADR-0278](0278-envoi-simultane-a-l-agent-et-au-n2.md)

## Contexte

L'agent télécharge son évaluation en PDF une fois validée, sans la partie
réservée (ADR-0268, ADR-0269) ; la DCH télécharge la fiche complète une
fois transmise (ADR-0221). Le N+1 et le N+2 n'avaient pas de copie, et la
fiche que garde le N+2 après une reprise (ADR-0278) ne se lisait qu'à
l'écran. L'APIX veut que tout le monde puisse télécharger la fiche, selon
ses responsabilités et ce que son rôle permet de lire.

## Décision

**Le N+1** : « Télécharger le PDF », dans le bandeau de l'agent, dès que
l'évaluation est transmise à l'agent, et jusqu'au bout, transmission à la
DCH et fin de la campagne comprises. Le PDF est la fiche complète, partie
réservée comprise, avec la validation en ligne de l'agent une fois faite
et les commentaires du N+2 une fois transmis. Avant la transmission,
« Valider » montre déjà la fiche en PDF (ADR-0260).

**Le N+2** : le même bouton, dès que le N+1 a envoyé la fiche au N+2, et
même après une reprise : c'est la copie du N+2. Le PDF est la fiche
complète, avec les commentaires du N+2 une fois transmis, jamais leur
brouillon.

**L'agent et la DCH** gardent leur téléchargement (ADR-0221, ADR-0268,
ADR-0269) : l'agent, sans la partie réservée, une fois l'évaluation
validée ; la DCH, la fiche complète une fois transmise.

Le fichier porte le nom de la fiche complète, comme pour la DCH :
`fiche-entretien-2026-{matricule}-complete.pdf`.

**L'API** : `GET /v1/campagne/equipe/{agent}/pdf`, réservée à
l'évaluateur de l'agent (404, `campagne.agent_hors_equipe`), une fois
l'évaluation transmise (sinon 409, `campagne.evaluation_non_transmise`) ;
`GET /v1/campagne/n2/{agent}/pdf`, réservée au N+2 de l'agent (404,
`campagne.agent_hors_perimetre`), une fois la fiche envoyée au N+2 (sinon
409, `campagne.fiche_non_envoyee`).

## Conséquences

- La partie réservée ne part jamais vers l'agent : son PDF reste sans elle.
- Après une reprise, le PDF du N+2, comme celui de la DCH, imprime
  « Néant » sous les commentaires du N+2.
- La conséquence de l'ADR-0221 selon laquelle le N+1 et le N+2 n'avaient
  pas leur copie du PDF ne tient plus.
