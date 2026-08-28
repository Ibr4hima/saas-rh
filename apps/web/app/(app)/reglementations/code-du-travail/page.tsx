import { TexteDeReference } from '../texte-de-reference';

export default function CodeDuTravailPage() {
  return (
    <TexteDeReference
      intro="Le Code du travail sénégalais fixe le socle : durée du travail, congés, contrats, fins de contrat. Voici ce que l’application en tient déjà, et ce qu’elle laisse encore à la main."
      appliques={[
        {
          titre: 'Jours fériés',
          detail:
            'calendrier propre à l’organisation, modifiable en cours d’année pour les fêtes mobiles (Korité, Tabaski), et exclu du décompte des congés.',
          lien: { href: '/absences/parametres', label: 'Gérer les jours fériés' },
        },
        {
          titre: 'Congés et absences',
          detail:
            'droits ouverts par type d’absence, soldes tenus par employé, décompte en jours ouvrables, et circuit de visa à plusieurs niveaux dont chaque décision est tracée.',
          lien: { href: '/absences', label: 'Voir les demandes' },
        },
        {
          titre: 'Contrats',
          detail:
            'CDI, CDD, stage, consultance et détachement, avec période d’essai et terme suivis ; les échéances remontent seules sur le tableau de bord.',
          lien: { href: '/dashboard', label: 'Suivi des contrats' },
        },
        {
          titre: 'Registre du personnel',
          detail:
            'un dossier par employé, un journal d’audit immuable de chaque modification, et les pièces d’identité chiffrées au stockage.',
          lien: { href: '/employees', label: 'Gestion du personnel' },
        },
      ]}
      aVenir={[
        {
          titre: 'Durée du travail et heures supplémentaires',
          detail:
            'le décompte hebdomadaire et la majoration des heures relèvent du module paie, qui n’est pas encore branché.',
        },
        {
          titre: 'Préavis et indemnités de fin de contrat',
          detail:
            'les barèmes dépendent de l’ancienneté et de la convention applicable : ils seront calculés avec le module paie.',
        },
      ]}
      depot="Déposez ici le texte en vigueur pour que chacun puisse s’y reporter depuis l’application, sans le chercher ailleurs. Le dépôt de documents de référence n’est pas encore ouvert."
    />
  );
}
