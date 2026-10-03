import { redirect } from 'next/navigation';

/**
 * L'ancienne « Gestion des demandes » : ses demandes et son calendrier des
 * absences vivent désormais sous « Demandes à traiter › Absences & Congés ».
 * Les anciens liens y mènent.
 */
export default function AbsencesPage() {
  redirect('/moi/dch');
}
