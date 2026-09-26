import { redirect } from 'next/navigation';

/**
 * La création se fait en fenêtre, sur la liste — on voit ce qu'on ajoute à ce
 * qui existe déjà. La route reste pour les liens et les signets.
 */
export default function NouvelleOffrePage() {
  redirect('/recrutement?nouvelle=1');
}
