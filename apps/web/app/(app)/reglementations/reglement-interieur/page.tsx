import { TexteDeReference } from '../texte-de-reference';

export default function ReglementInterieurPage() {
  return (
    <TexteDeReference
      intro="Le règlement intérieur est le texte de l’organisation elle-même : horaires, discipline, hygiène et sécurité, usage des moyens de travail. Il ne se déduit d’aucune loi — il se rédige, se dépose, et s’oppose à chacun une fois porté à sa connaissance."
      appliques={[
        {
          titre: 'Journal des modifications',
          detail:
            'chaque décision RH est horodatée et attribuée : qui a fait quoi, quand, avec quel commentaire. C’est ce que réclame une procédure disciplinaire contestée.',
        },
        {
          titre: 'Espace personnel de l’employé',
          detail:
            'chacun accède à son dossier, ses congés et ses documents depuis son propre compte : la diffusion d’un texte à tout l’effectif y trouvera son canal.',
          lien: { href: '/employees', label: 'Comptes du portail' },
        },
      ]}
      aVenir={[
        {
          titre: 'Accusé de lecture',
          detail:
            'un règlement n’est opposable qu’une fois porté à la connaissance de l’employé : la trace de cette prise de connaissance reste à construire.',
        },
        {
          titre: 'Procédure disciplinaire',
          detail:
            'convocation, entretien, sanction et recours : un circuit dédié viendra s’appuyer sur le journal d’audit existant.',
        },
      ]}
      depot="Déposez ici le règlement intérieur de l’organisation pour que chaque employé puisse le consulter depuis son espace. Le dépôt de documents de référence n’est pas encore ouvert."
    />
  );
}
