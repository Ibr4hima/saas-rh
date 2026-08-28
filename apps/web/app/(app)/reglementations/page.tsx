import { redirect } from 'next/navigation';

/**
 * La rubrique n'a pas d'écran à elle : ses trois textes sont les
 * destinations. On atterrit sur le premier plutôt que sur une page d'accueil
 * qui ne ferait que répéter le menu.
 */
export default function ReglementationsPage() {
  redirect('/reglementations/code-du-travail');
}
