'use client';

import { TableauDeBord } from '../../../../components/tableau-de-bord';

/** Le tableau de bord du directeur général, dans son espace. */
export default function TableauDeBordDG() {
  return <TableauDeBord suiviDesContrats={false} />;
}
