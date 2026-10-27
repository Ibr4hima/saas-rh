# Scénario « Trésor public » — la paie APIX et ses implications

> **Statut** : hypothèse à confirmer. Le fondateur indique que les salaires APIX seraient versés par le Trésor public. Ce document instruit les deux scénarios possibles et fixe la checklist de questions à poser à la RH APIX. **Aucune décision de la Phase 2 (paie) n'est modifiée tant que les réponses ne sont pas connues.**

## 1. Pourquoi c'est structurant

Si le Trésor liquide et verse les salaires APIX, alors l'APIX n'est **pas** le bon terrain de validation du moteur de paie — et le pilote APIX devient un pilote « Core HR + congés + recrutement + e-sign » plus rapide et moins risqué. Mais la paie reste **la** différenciation commerciale du produit (cf. [01-vision-produit.md](01-vision-produit.md) §1.2 et §4.1) : sans elle, Teranga RH est « un BambooHR francophone de plus ». Le scénario Trésor déplace donc le _terrain de validation_ de la paie, pas sa place dans le produit.

## 2. Checklist de questions pour la RH APIX

À poser telles quelles — les réponses conditionnent le périmètre du Lot 2 :

1. **Qui calcule** la rémunération chaque mois (salaire de base, mais surtout primes, indemnités, heures supplémentaires) ? L'APIX en interne, le Trésor, ou un partage ?
2. **Qui produit les bulletins de paie** remis aux agents ? Sous quel format ? Avec quel outil ?
3. Quels **états ou fichiers** l'APIX transmet-elle au Trésor chaque mois (éléments variables, mouvements de personnel, états de liquidation) ? Formats exacts ?
4. Y a-t-il des **populations payées différemment** ? (contractuels de droit privé payés directement par l'APIX, détachés de la fonction publique au régime FNR, stagiaires, consultants)
5. Qui fait les **déclarations sociales et fiscales** (IPRES, CSS, IR/TRIMF, CFCE) et pour quelles populations ? L'APIX est-elle affiliée à une **IPM** ?
6. Qui gère **acomptes, avances et prêts au personnel**, et comment sont-ils récupérés sur la paie ?
7. Qui calcule les **soldes de tout compte** et produit les documents de sortie ?
8. Où vivent aujourd'hui les **cumuls de paie** (brut fiscal annuel, IR retenu, cumuls IPRES) et peut-on en obtenir un export ?
9. La RH souhaite-t-elle que le futur SI RH **prépare les états destinés au Trésor** (saisie des éléments variables, contrôles, export au format attendu) ?
10. Peut-on obtenir **12 mois de bulletins anonymisés** (tous profils : cadre, non-cadre, avec heures sup, avec avantage en nature) pour le corpus de référence du moteur ?

## 3. Les deux scénarios

### Scénario A — le Trésor fait tout (calcul + bulletins + déclarations)

- Le **Lot 2 APIX change de nature** : plus de moteur de paie pour l'APIX, mais un module léger « **interface Trésor** » : collecte des éléments variables (absences, primes, mouvements), contrôles de cohérence, génération des états au format Trésor, archivage des bulletins reçus dans le coffre-fort employé.
- Le **moteur de paie se construit quand même en Phase 2**, mais se valide avec un **autre design partner** : une PME dakaroise de 50-200 salariés ou un cabinet d'expertise comptable partenaire (qui devient du même coup le canal de distribution — double gain).
- Le pilote APIX se recentre : Core HR + congés + portail + attestations + e-sign + onboarding. **Time-to-value plus court, risque réduit** — et l'engagement design partner APIX doit être renégocié en conséquence (critères d'acceptation sans paie).

### Scénario B — l'APIX calcule en interne (le Trésor ne fait que verser)

- Le Lot 2 reste conforme au dossier : moteur de paie complet, avec une **sortie « ordre de virement Trésor »** au lieu du fichier bancaire classique.
- Les spécificités du public s'ajoutent au pack SN : populations mixtes (privé/détachés FNR), régimes de primes propres au parapublic — l'**audit de population** ([09-revue-critique.md](09-revue-critique.md), backlog #6) devient le premier livrable de la Phase 2.

### Dans les deux cas

- La **Phase 0 et le Lot 1 ne changent pas d'un iota** — c'est toute la valeur de l'arbitrage « deux lots » : on peut démarrer maintenant sans attendre la réponse.
- Le schéma de données paie (PayrollRun/Payslip/PayslipLine, rubriques par pays) reste dans les fondations : il coûte peu à poser et rend les deux scénarios réversibles.
- La **veille réglementaire** et le partenariat expert-comptable (backlog #8) restent nécessaires — pour le marché PME, pas pour l'APIX.

## 4. Décision par défaut

Tant que la RH n'a pas répondu : on continue comme si le **scénario A** était vrai (c'est le plus probable pour une agence d'État et le plus conservateur pour le planning), tout en gardant le schéma de données paie dans les fondations. Premier point de bascule : la rédaction de l'engagement design partner APIX (semaine 1), qui doit lister explicitement le périmètre du Lot 2 « sous réserve des réponses à la checklist §2 ».
