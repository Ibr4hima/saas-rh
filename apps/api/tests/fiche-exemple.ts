/**
 * Une fiche d'entretien remplie, pour les tests et pour regarder le PDF :
 * un agent cadre, son N+1 et son N+2, trois objectifs, toutes les parties.
 */
import type { DonneesDeLaFiche } from '../src/modules/entretiens/fiche-pdf';

const O1 = '0b7f1a52-3c3e-4a59-9f2f-1e0f7a3b5c01';
const O2 = '0b7f1a52-3c3e-4a59-9f2f-1e0f7a3b5c02';
const O3 = '0b7f1a52-3c3e-4a59-9f2f-1e0f7a3b5c03';

export function ficheExemple(o: Partial<DonneesDeLaFiche> = {}): DonneesDeLaFiche {
  return {
    annee: 2026,
    personnel: 'cadre',
    agent: {
      prenom: 'Moussa',
      nom: 'Sarr',
      fonction: 'Analyste économique',
      matricule: 'EMP-002',
      direction: 'Direction des Études et de la Prospective',
      departement: 'Département des Études économiques',
      service: null,
      anciennete: '3 ans et 2 mois',
      posteDepuis: '2023-09-01',
    },
    n1: {
      prenom: 'Awa',
      nom: 'Diop',
      fonction: 'Responsable du département des Études économiques',
    },
    dateDeLEntretien: '2026-12-22',
    objectifs: [
      {
        id: O1,
        intitule: 'Publier le tableau de bord trimestriel des investissements',
        indicateurs: 'Quatre tableaux publiés ; chacun moins de 15 jours après la fin du trimestre',
      },
      {
        id: O2,
        intitule: 'Conduire l’étude sur l’attractivité des zones économiques spéciales',
        indicateurs: 'Rapport validé par la Direction générale avant le 30 septembre',
      },
      {
        id: O3,
        intitule: 'Former deux collègues à l’outil de modélisation',
        indicateurs: 'Deux sessions tenues ; collègues autonomes sur l’outil',
      },
    ],
    auto: {
      vecu: 'Une année dense et motivante. La refonte du tableau de bord a demandé beaucoup d’énergie au premier semestre, mais le résultat est là.',
      aDesDifficultes: true,
      difficultes:
        'Des données arrivées en retard de la part de deux partenaires.\nUn logiciel de modélisation installé seulement en avril.',
      objectifs: {
        [O1]: {
          niveau: 'A',
          resultats: 'Quatre tableaux publiés, en moyenne 9 jours après la fin du trimestre.',
          commentaire: 'Le nouveau circuit de collecte a fait gagner une semaine.',
        },
        [O2]: {
          niveau: 'B',
          resultats: 'Rapport remis le 25 septembre, validé le 10 octobre.',
          commentaire: 'La validation a pris plus de temps que prévu.',
        },
        [O3]: {
          niveau: 'C',
          resultats: 'Une session tenue sur deux.',
          commentaire: 'La seconde session a été reportée faute de salle disponible.',
        },
      },
      autresRealisations:
        'Appui à la préparation du forum Invest in Sénégal ; rédaction de deux notes de conjoncture.',
      avenir: 'Évoluer vers la gestion de projets d’études, à moyen terme.',
      missions:
        'Les études de terrain et la modélisation.\nJe souhaite développer l’animation de formations.',
      contraintes: 'L’accès aux données des partenaires reste lent.',
      aDesCompetencesInexploitees: true,
      competencesInexploitees: 'La maîtrise de l’anglais, peu utilisée aujourd’hui.',
      autresCommentaires: '',
    },
    evaluation: {
      objectifs: {
        [O1]: {
          niveau: 'A',
          commentaire: 'Résultat remarquable, salué par la Direction générale.',
        },
        [O2]: {
          niveau: 'B',
          commentaire: 'Objectif atteint ; la validation tardive ne dépendait pas de l’agent.',
        },
        [O3]: { niveau: 'C', commentaire: 'À reprendre au premier trimestre 2027.' },
      },
      competences: {
        connaissances: 'A',
        qualite: 'A',
        organisation: 'B',
        initiative: 'B',
        engagement: 'A',
        equipe: 'B',
        responsabilite: 'A',
        imprevus: 'B',
        assiduite: 'B',
        resolution: 'B',
        management: null,
      },
      pointsForts:
        '- Rigueur et qualité des analyses\n- Grande fiabilité dans les délais\n- Bonne communication avec les partenaires',
      axesDeDeveloppement: '- Prise de parole en réunion\n- Délégation des tâches de collecte',
      plan: [
        {
          action: 'Formation à la prise de parole en public',
          delai: 'Mars 2027',
          suivi: 'Bilan avec le N+1 au retour de formation',
        },
        {
          action: 'Mentorat dans l’équipe de gestion de projets',
          delai: 'Toute l’année 2027',
          suivi: 'Point mensuel',
        },
      ],
      formations: [
        {
          intitule: 'Prise de parole en public',
          justification: 'Présenter les études devant les partenaires.',
        },
        {
          intitule: 'Économétrie appliquée, niveau avancé',
          justification: 'Renforcer les modèles du tableau de bord.',
        },
      ],
      entretienConfirme: true,
      dateDeLEntretien: '2026-12-22',
    },
    reservee: {
      comprehension: 'A',
      tenue: 'B',
      observations: 'Fort potentiel. À accompagner vers des responsabilités de gestion de projet.',
    },
    validations: { n1: '2026-12-22', agent: '2026-12-23' },
    n2: {
      prenom: 'Aminata',
      nom: 'Ndour',
      fonction: 'Responsable de la Direction des Études et de la Prospective',
      le: '2026-12-28',
      commentaires: 'Avis conforme à celui du N+1.',
    },
    ...o,
  };
}
