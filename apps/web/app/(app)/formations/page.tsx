import { redirect } from 'next/navigation';

/*
   « Formations » est devenue APIX Academy. L'ancienne adresse reste valable —
   un favori, un lien dans un courriel — et mène au bon endroit.
*/
export default function FormationsPage() {
  redirect('/academy');
}
