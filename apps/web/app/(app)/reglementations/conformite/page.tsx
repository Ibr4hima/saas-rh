import { TexteDeReference } from '../texte-de-reference';

export default function ConformitePage() {
  return (
    <TexteDeReference
      intro="Ce que l’application garantit face aux obligations qui ne viennent d’aucun texte du travail : protection des données personnelles, traçabilité des décisions, et déclarations aux organismes. C’est un état à constater, pas un document à déposer."
      appliques={[
        {
          titre: 'Protection des données personnelles',
          detail:
            'cloisonnement strict des données par organisation, imposé au niveau de la base et non de l’application ; pièces d’identité chiffrées au stockage ; aucune donnée d’un employeur n’est lisible depuis un autre.',
        },
        {
          titre: 'Journal d’audit immuable',
          detail:
            'chaque création, modification et suppression est horodatée et attribuée à son auteur, sans possibilité de réécriture. C’est ce qu’exige une demande d’accès comme une procédure contestée.',
        },
        {
          titre: 'Traçabilité des décisions',
          detail:
            'chaque visa d’un circuit de validation porte son auteur, sa date et son commentaire : une décision ne peut pas apparaître sans qu’on sache qui l’a prise.',
          lien: { href: '/absences', label: 'Voir les circuits' },
        },
        {
          titre: 'Échéances de contrat',
          detail:
            'les fins de CDD et de stage remontent seules, sur le tableau de bord et par notification, avant qu’elles ne deviennent une reconduction tacite.',
          lien: { href: '/dashboard', label: 'Suivi des contrats' },
        },
      ]}
      aVenir={[
        {
          titre: 'Déclarations sociales et fiscales',
          detail:
            'IPRES, Caisse de Sécurité Sociale et DGID seront générées par le module paie : elles supposent des assiettes de cotisation que l’application ne calcule pas encore.',
        },
        {
          titre: 'Droit d’accès et portabilité',
          detail:
            'l’export du dossier complet d’un employé, à sa demande, reste à outiller — les données sont là, l’extraction en un geste ne l’est pas.',
        },
        {
          titre: 'Périodes d’essai et visites médicales',
          detail:
            'leurs échéances ne sont pas encore suivies, à la différence des fins de contrat.',
        },
      ]}
    />
  );
}
