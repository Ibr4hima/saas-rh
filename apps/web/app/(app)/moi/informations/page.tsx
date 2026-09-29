import { redirect } from 'next/navigation';

/** « Mes informations » est devenu l'accueil de l'espace personnel. */
export default function AnciennesInformations() {
  redirect('/moi');
}
