'use client';

import Link from 'next/link';
import { EcranMarque } from '../../../components/ecran-marque';
import { FormulaireMotDePasse } from '../../../components/formulaire-mot-de-passe';
import { pageDeRetour } from '../connexion';

/**
 * La connexion par mot de passe, à côté de celle par code (ADR-0204) : pour
 * qui en a un et préfère s'en servir.
 */
export default function ConnexionParMotDePassePage() {
  return (
    <EcranMarque
      titre="Connexion"
      sousTitre={
        <>
          Accédez à votre espace avec votre compte{' '}
          <span className="font-semibold text-ink">@apix.sn</span>
        </>
      }
      // « Créer une organisation » n'avait rien à faire là : l'APIX a la
      // sienne, et qui arrive sur cet écran n'en fonde pas une seconde : son
      // mot de passe s'est perdu. La place revient au seul besoin réel de qui
      // ne parvient pas à entrer.
      pied={
        <>
          Mot de passe oublié ?{' '}
          <Link
            href="/mot-de-passe-oublie"
            className="font-bold text-primary underline-offset-4 hover:underline"
          >
            Réinitialisez-le
          </Link>
          .
        </>
      }
    >
      <FormulaireMotDePasse destination={pageDeRetour} />
    </EcranMarque>
  );
}
