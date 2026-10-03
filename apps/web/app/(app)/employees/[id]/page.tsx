'use client';

import { useParams } from 'next/navigation';
import { FicheEmploye } from '../../../../components/fiche-employe';

/** La fiche d'un agent, dans la gestion du personnel. */
export default function EmployeePage() {
  const { id } = useParams<{ id: string }>();
  return <FicheEmploye id={id} />;
}
