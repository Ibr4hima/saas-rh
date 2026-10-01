'use client';

import dynamic from 'next/dynamic';
import { Fragment, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FicheObjectifs, MesObjectifs, ObjectifView } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import { BoutonCommentaires, CommentairesAgent } from '../../../../components/evaluation-objectifs';
import { FicheSemestre, parAnnee, SeparateurAnnee } from '../../../../components/fiches-semestres';
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
 * Un semestre, vu par l'agent. La fiche que son n+1 a rédigée, où il coche ce
 * qu'il a atteint ; en bas à droite, « Commentaires » : sous chaque objectif,
 * ce qu'il a fait, ce qui manque — à enregistrer, puis à envoyer.
 */
function CarteSemestre({
  fiche,
  formations,
}: {
  fiche: FicheObjectifs;
  formations: MesObjectifs['formations'];
}) {
  const queryClient = useQueryClient();
  const [commentaires, setCommentaires] = useState(false);
  const [coches, setCoches] = useState(fiche.coches);
  const [erreur, setErreur] = useState<string | null>(null);
  const envoyes = Boolean(fiche.evaluation.envoyesLe);
  const cochesServeur = fiche.coches.join('|');
  // Ce qui arrive du serveur fait foi — après un rechargement, par exemple.
  useEffect(() => setCoches(fiche.coches), [cochesServeur]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Cocher se voit tout de suite ; le serveur confirme, ou l'on revient en arrière. */
  const cocher = async (id: string, coche: boolean) => {
    const avant = coches;
    setCoches(coche ? [...coches, id] : coches.filter((c) => c !== id));
    setErreur(null);
    try {
      const r = await api<{ coches: string[] }>(
        `/objectifs/moi/fiches/${fiche.annee}/${fiche.semestre}/coches`,
        { method: 'PUT', body: { id, coche } },
      );
      queryClient.setQueryData<MesObjectifs>([...CLE_OBJECTIFS, 'moi'], (d) =>
        d
          ? {
              ...d,
              fiches: d.fiches.map((x) =>
                x.annee === fiche.annee && x.semestre === fiche.semestre
                  ? { ...x, coches: r.coches }
                  : x,
              ),
            }
          : d,
      );
    } catch (e) {
      setCoches(avant);
      setErreur(e instanceof ApiError ? e.message : 'Case non enregistrée — réessayez.');
    }
  };

  const bascule = (
    <BoutonCommentaires
      fiche={fiche}
      actif={commentaires}
      onClick={() => setCommentaires((v) => !v)}
    />
  );

  return (
    <FicheSemestre
      annee={fiche.annee}
      semestre={fiche.semestre}
      note={
        <>
          {fiche.auteur ? `${fiche.auteur} · ` : ''}mis à jour le{' '}
          {new Date(fiche.majLe).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
        </>
      }
    >
      {commentaires ? (
        <CommentairesAgent
          fiche={fiche}
          coches={coches}
          onCocher={(id, coche) => void cocher(id, coche)}
          bascule={bascule}
        />
      ) : (
        <>
          <EditeurFicheObjectifs
            // Le n+1 a changé la fiche : elle se relit telle qu'il l'a laissée.
            key={fiche.majLe}
            className="pt-3 pb-1"
            contenu={fiche.contenu}
            modifiable={false}
            formations={formations}
            coches={coches}
            onCocher={envoyes ? undefined : (id, coche) => void cocher(id, coche)}
          />
          <div className="flex flex-wrap items-center justify-end gap-3 px-5 pb-4">
            {erreur ? (
              <p role="alert" className="mr-auto text-[12px] font-semibold text-danger">
                {erreur}
              </p>
            ) : null}
            {bascule}
          </div>
        </>
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
