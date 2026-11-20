'use client';

import Link from 'next/link';
import { EcranMarque } from '../../../components/ecran-marque';
import { FormulaireMotDePasse } from '../../../components/formulaire-mot-de-passe';
import { pageDeRetour } from '../../login/connexion';

/**
 * La connexion de l'administration (ADR-0210) : l'adresse et le mot de passe,
 * sur le même écran que celui des agents. Le compte d'administration n'a pas
 * d'adresse de l'APIX, la connexion par code ne lui sert donc pas. Seul un
 * compte d'administration y ouvre sa session ; aucun écran des agents n'y
 * mène.
 */
export default function ConnexionDeLAdministrationPage() {
  return (
    <EcranMarque
      titre="Connexion"
      sousTitre="Accédez à l’espace d’administration"
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
      note={{ icone: 'lock', texte: 'Accès réservé aux comptes d’administration' }}
    >
      <FormulaireMotDePasse administration destination={pageDeRetour} />
    </EcranMarque>
  );
}
