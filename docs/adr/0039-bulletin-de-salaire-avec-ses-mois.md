# ADR-0039 : Le bulletin de salaire se demande avec ses mois

**Statut** : acceptée · 2026-10-08

## Contexte

Un bulletin de salaire se demandait sans dire lequel. Les mois, quand on y
pensait, allaient dans la précision libre : la DCH devait les y chercher,
ou les redemander.

## Décision

**Un bulletin se demande pour une période**, obligatoire, de trois façons :
un mois, les N derniers mois (de deux à douze), ou de tel mois à tel mois
(douze au plus). La précision reste pour le motif (banque, visa).

**Elle s'écrit à part** (migration 0098) : le premier et le dernier mois
(`payslip_from`, `payslip_to`, au 1er du mois, le même pour un seul mois),
ou le nombre de derniers mois (`payslip_last_months`). Deux contraintes la
tiennent en base : une seule forme à la fois, douze mois au plus ; des mois
pour un bulletin seulement.

**Des mois possibles** : aucun mois à venir (le mois en cours se demande,
la paie tombant en fin de mois), aucun mois d'avant l'arrivée de l'agent,
pas plus de derniers mois que de mois passés à l'APIX. Le formulaire ne
propose que ceux-là ; le serveur refuse les autres.

**Le bulletin se nomme avec ses mois** partout où la demande se lit : la
file de la DCH, le suivi de l'agent, les avis (« Moussa Ndiaye demande ses
3 derniers bulletins de salaire », « Votre bulletin de salaire d'avril 2025
est prêt »).

## Conséquences

- Les N derniers mois se comptent depuis la date de la demande : la DCH
  sait si le bulletin du mois en cours est établi.
- Une seule demande de bulletin reste ouverte à la fois, comme pour tout
  document : pour d'autres mois, l'agent annule et redemande, ou attend
  qu'elle soit prête.
- Les bulletins demandés avant gardent leur précision libre, sans mois.
