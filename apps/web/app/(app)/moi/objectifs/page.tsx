'use client';

import dynamic from 'next/dynamic';
import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FicheObjectifs, MesObjectifs, ObjectifView } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import { api } from '../../../../lib/api';
import { FicheSemestre, parAnnee, SeparateurAnnee } from '../../../../components/fiches-semestres';
import {
  BarreFiche,
  EvaluationAgent,
  StatutEvaluation,
  type Onglet,
} from '../../../../components/evaluation-semestre';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { CLE_OBJECTIFS, LigneObjectif } from '../../../../components/objectifs';

// L'éditeur, en lecture : les fiches telles que le n+1 les a rédigées.
const EditeurFicheObjectifs = dynamic(
  () => import('../../../../components/fiche-objectifs').then((m) => m.EditeurFicheObjectifs),
  { ssr: false, loading: () => <Skeleton className="mx-5 my-2 h-16" /> },
);

/**
 * Mes objectifs, année par année : les fiches que le n+1 rédige pour chaque
 * semestre — le plus récent d'abord —, puis, pour l'année en cours, les
 * objectifs de la direction et les orientations de l'APIX qui sont diffusées.
 */
export default function MesObjectifsPage() {
  const mes = useQuery({
    queryKey: [...CLE_OBJECTIFS, 'moi'],
    queryFn: () => api<MesObjectifs>('/objectifs/moi'),
  });

  if (mes.isLoading || !mes.data) {
    return (
      <Page>
        <Skeleton className="h-40 w-full rounded-[16px]" />
        <Skeleton className="h-40 w-full rounded-[16px]" />
      </Page>
    );
  }

  const { apix, direction, individuels, annee, fiches, formations } = mes.data;
  // Les objectifs posés un à un, avant les fiches, restent lisibles tant
  // qu'aucune fiche ne les remplace.
  const anciens = fiches.length === 0 ? individuels : [];
  const autourDeLAnnee =
    anciens.length > 0 || Boolean(direction?.objectifs.length) || apix.length > 0;
  const groupes = parAnnee(fiches, autourDeLAnnee ? annee : undefined);

  if (groupes.length === 0) {
    return (
      <Page>
        <Card>
          <EmptyState
            className="py-14"
            icon={<Icon name="flag" size={22} />}
            title={`Aucun objectif pour ${annee}`}
          />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      {groupes.map((groupe) => (
        <Fragment key={groupe.annee}>
          <SeparateurAnnee annee={groupe.annee} />
          {groupe.fiches.map((f) => (
            <CarteSemestre key={`${f.annee}-${f.semestre}`} fiche={f} formations={formations} />
          ))}
          {groupe.annee === annee ? (
            <>
              {anciens.length ? (
                <Section titre="Mes objectifs" objectifs={anciens} auteur lienFormation />
              ) : null}
              {direction?.objectifs.length ? (
                <Section titre={direction.nom} objectifs={direction.objectifs} />
              ) : null}
              {apix.length ? (
                <Section titre="Orientations de l’APIX" objectifs={apix} compteur={false} />
              ) : null}
            </>
          ) : null}
        </Fragment>
      ))}
    </Page>
  );
}

/**
 * Un semestre, vu par l'agent : ses objectifs, tels que son n+1 les a fixés,
 * et leur évaluation — la sienne d'abord, puis celle de son n+1.
 */
function CarteSemestre({
  fiche,
  formations,
}: {
  fiche: FicheObjectifs;
  formations: MesObjectifs['formations'];
}) {
  // Une évaluation validée, pas encore signée : c'est là qu'on a à faire.
  const [onglet, setOnglet] = useState<Onglet>(
    fiche.evaluation?.valideeLe && !fiche.evaluation.signeeLe ? 'evaluation' : 'objectifs',
  );
  return (
    <FicheSemestre annee={fiche.annee} semestre={fiche.semestre}>
      <BarreFiche
        statut={<StatutEvaluation fiche={fiche} vue="agent" />}
        onglet={onglet}
        onOnglet={setOnglet}
      />
      {onglet === 'evaluation' ? (
        <EvaluationAgent fiche={fiche} />
      ) : (
        <EditeurFicheObjectifs
          className="pt-3 pb-4"
          contenu={fiche.contenu}
          modifiable={false}
          formations={formations}
        />
      )}
    </FicheSemestre>
  );
}

function Section({
  titre,
  objectifs,
  auteur,
  lienFormation,
  compteur = true,
}: {
  titre: string;
  objectifs: ObjectifView[];
  auteur?: boolean;
  lienFormation?: boolean;
  /** Combien sont atteints — les orientations de l'APIX ne se comptent pas. */
  compteur?: boolean;
}) {
  const atteints = objectifs.filter((o) => o.atteint).length;
  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>{titre}</CardTitle>
        {compteur ? (
          <span className="shrink-0 text-[11.5px] text-ink-muted tabular-nums">
            {atteints}/{objectifs.length} atteint{atteints > 1 ? 's' : ''}
          </span>
        ) : null}
      </CardHeader>
      <ul className="flex flex-col px-2 pb-2">
        {objectifs.map((o) => (
          <LigneObjectif key={o.id} objectif={o} auteur={auteur} lienFormation={lienFormation} />
        ))}
      </ul>
    </Card>
  );
}
