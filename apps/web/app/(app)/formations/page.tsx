import Link from 'next/link';
import { ModuleAVenir } from '../../../components/module-a-venir';

/*
   Formations — la moitié « action » de la GPEC.

   Le plan de formation existe déjà à l'APIX : il vit dans un classeur et dans
   des échanges de courriels. L'écran ne l'invente pas, il lui donne un
   endroit, et surtout il le raccorde à l'écart que la cartographie mesure.
*/
export default function FormationsPage() {
  return (
    <ModuleAVenir
      icone="school"
      promesse="Le plan de formation de l’année : ce qui est prévu, qui y va, ce que cela coûte, et ce que cela a changé."
      points={[
        'Un catalogue — interne, externe, en ligne — et des sessions datées, avec leurs places.',
        'Les inscriptions, l’avis du manager et les présences effectives, à la place des courriels.',
        'Le budget engagé et consommé, par direction : la question qui revient à chaque arbitrage.',
        'Les attestations et diplômes rangés dans le dossier de l’agent, disponibles sans les redemander.',
        'Le lien avec la cartographie : une formation suivie fait monter un niveau, et l’écart se referme visiblement.',
      ]}
      note={
        <>
          Demandé par la Direction du Capital Humain, et déjà au périmètre cible : dossier
          d’architecture, chapitre 01 — module « Formation » (catalogue, sessions, budget,
          obligations légales), priorité V2. Il se lit avec{' '}
          <Link href="/competences" className="text-primary hover:underline">
            la cartographie des compétences
          </Link>
          .
        </>
      }
    />
  );
}
