import { TexteDeReference } from '../texte-de-reference';

export default function ConventionCollectivePage() {
  return (
    <TexteDeReference
      intro="La convention collective précise et améliore le Code du travail pour la branche : droits à congés selon l’ancienneté, préavis, indemnités, classifications. L’application ne l’interprète pas encore — elle en applique les effets là où ils ont été paramétrés à la main."
      appliques={[
        {
          titre: 'Droits à congés paramétrables',
          detail:
            'chaque type d’absence porte son propre droit annuel : ce que la convention accorde au-delà du minimum légal se saisit ici plutôt que d’être codé en dur.',
          lien: { href: '/absences/parametres', label: 'Paramètres des congés' },
        },
        {
          titre: 'Circuits de validation',
          detail:
            'la chaîne de visas suit la ligne hiérarchique définie dans l’organigramme, à autant de niveaux que nécessaire.',
          lien: { href: '/organisation', label: 'Organigramme' },
        },
      ]}
      aVenir={[
        {
          titre: 'Ancienneté et droits progressifs',
          detail:
            'les jours supplémentaires acquis par tranche d’ancienneté seront calculés automatiquement à partir de la date d’embauche.',
        },
        {
          titre: 'Classifications et grilles',
          detail: 'catégories, échelons et grilles indiciaires arriveront avec le module paie.',
        },
      ]}
      depot="Déposez ici la convention applicable à l’organisation. Tant qu’elle n’est pas déposée, les règles qu’elle porte doivent être saisies à la main dans les paramètres."
    />
  );
}
