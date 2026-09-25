import Link from 'next/link';
import { ModuleAVenir } from '../../../components/module-a-venir';

/*
   Cartographie des compétences — la moitié « état des lieux » de la GPEC.

   Elle répond à une question que le tableau des effectifs ne sait pas poser :
   non pas COMBIEN sommes-nous, mais QUE SAVONS-NOUS FAIRE. Le plan de
   formation, lui, est la moitié « action » : l'écart mesuré ici est ce qu'il
   a pour mission de combler.
*/
export default function CompetencesPage() {
  return (
    <ModuleAVenir
      icone="hub"
      promesse="Ce que l’agence sait faire — métier par métier, direction par direction, agent par agent."
      points={[
        'Un référentiel des emplois et des compétences : ce que chaque poste exige, du niveau débutant au niveau référent.',
        'Le niveau réel de chaque agent, tenu à jour après les entretiens plutôt que dans un classeur parallèle.',
        'L’ÉCART entre l’exigence du poste et le niveau atteint, lu par direction : c’est lui qui fonde le plan de formation.',
        'Les compétences ne tenant qu’à UNE personne — le risque qu’on ne voit jamais venir avant un départ, une mutation ou une retraite.',
        'La recherche inverse, « qui sait faire cela ? », pour monter une équipe projet sans faire le tour des bureaux.',
      ]}
      note={
        <>
          Demandé par la Direction du Capital Humain. Cadre de référence : la gestion prévisionnelle
          des emplois et des compétences (GPEC), dont cet écran est l’état des lieux et{' '}
          <Link href="/academy" className="text-primary hover:underline">
            APIX Academy
          </Link>{' '}
          l’action.
        </>
      }
    />
  );
}
