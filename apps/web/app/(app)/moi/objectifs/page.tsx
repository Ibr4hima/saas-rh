'use client';

// La feuille de l'éditeur part avec la page, pas avec l'éditeur chargé à la
// demande : une feuille venue d'un module différé peut manquer à l'affichage
// (cases au-dessus du texte, cadre de focus du navigateur autour de la fiche).
import '@blocknote/mantine/style.css';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  FicheObjectifs,
  MesObjectifs,
  ObjectifView,
  StatutObjectif,
} from '@teranga/contracts';
import { dateEnLettres, objectifsDeLaFiche, ouvertureDeLAutoEvaluation } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, EmptyState, Skeleton } from '@teranga/ui';
import { api, ApiError } from '../../../../lib/api';
import {
  AutoEvaluationAgent,
  BoutonAutoEvaluation,
} from '../../../../components/evaluation-objectifs';
import { FicheAnnuelle, SeparateurAnnee } from '../../../../components/fiches-annuelles';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { CLE_OBJECTIFS, LigneObjectif } from '../../../../components/objectifs';
import { aujourdhui } from '../../../../lib/temps';

// L'éditeur, en lecture : les fiches telles que le n+1 les a rédigées.
const EditeurFicheObjectifs = dynamic(
  () => import('../../../../components/fiche-objectifs').then((m) => m.EditeurFicheObjectifs),
  { ssr: false, loading: () => <Skeleton className="mx-5 my-2 h-16" /> },
);

/**
 * Mes objectifs, une année à la fois (ADR-0078), comme la fiche d'un direct :
 * « ANNÉE 2026 » se déroule sur l'année en cours et celles qui ont une fiche.
 * Pour l'année choisie, la fiche que le n+1 rédige ; pour l'année en cours,
 * les objectifs de la direction et les orientations de l'APIX qui sont
 * diffusées. L'adresse garde l'année (`?annee=2027`) : un avis y mène,
 * recharger la page n'en change rien.
 */
export default function MesObjectifsPage() {
  // L'année choisie dans la liste ; sans choix, l'année en cours.
  const [choisie, setChoisie] = useState<number | null>(null);
  useEffect(() => {
    const a = Number(new URLSearchParams(window.location.search).get('annee'));
    if (Number.isInteger(a) && a >= 2000 && a <= 2100) setChoisie(a);
  }, []);
  const choisirAnnee = (a: number) => {
    setChoisie(a);
    window.history.replaceState(null, '', `?annee=${a}`);
  };
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

  const {
    apix,
    direction,
    individuels,
    annee: enCours,
    fiches,
    formations,
    jourEvaluation,
  } = mes.data;
  const annee = choisie ?? enCours;
  // La liste des années : l'année en cours, et celles qui ont une fiche
  // (l'année suivante quand le n+1 l'a préparée, ou qu'un objectif y est
  // reporté ; les années passées), la plus récente d'abord.
  const annees = [...new Set([enCours, annee, ...fiches.map((f) => f.annee)])].sort(
    (a, b) => b - a,
  );
  const fiche = fiches.find((f) => f.annee === annee) ?? null;
  // Les objectifs posés un à un, avant les fiches, restent lisibles tant
  // qu'aucune fiche ne les remplace.
  const anciens = fiches.length === 0 ? individuels : [];
  const autour =
    annee === enCours &&
    (anciens.length > 0 || Boolean(direction?.objectifs.length) || apix.length > 0);

  return (
    <Page>
      <SeparateurAnnee annee={annee} choix={{ annees, onChoisir: choisirAnnee }} />
      {fiche ? (
        <CarteAnnee
          key={fiche.annee}
          fiche={fiche}
          formations={formations}
          jourEvaluation={jourEvaluation}
        />
      ) : null}
      {autour ? (
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
      {!fiche && !autour ? (
        <Card>
          <EmptyState
            className="py-14"
            icon={<Icon name="flag" size={22} />}
            title={`Aucun objectif pour ${annee}`}
          />
        </Card>
      ) : null}
    </Page>
  );
}

/**
 * L'année, vue par l'agent. La fiche que son n+1 a rédigée : en cours
 * d'année, l'agent y coche ce qui est terminé (ADR-0076). Deux semaines avant
 * le jour de l'évaluation, « Auto-évaluation » s'ouvre en bas à droite : sous
 * chaque objectif, atteint, partiellement ou non (ADR-0079), puis l'envoi.
 */
function CarteAnnee({
  fiche,
  formations,
  jourEvaluation,
}: {
  fiche: FicheObjectifs;
  formations: MesObjectifs['formations'];
  jourEvaluation: string;
}) {
  const queryClient = useQueryClient();
  const [autoEvaluation, setAutoEvaluation] = useState(false);
  const [statuts, setStatuts] = useState(fiche.statuts);
  const [erreur, setErreur] = useState<string | null>(null);
  const statutsServeur = JSON.stringify(fiche.statuts);
  // Ce qui arrive du serveur fait foi — après un rechargement, par exemple.
  useEffect(() => setStatuts(fiche.statuts), [statutsServeur]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Le choix se voit tout de suite ; le serveur confirme, ou l'on revient en arrière. */
  const statuer = async (id: string, statut: StatutObjectif | null) => {
    const avant = statuts;
    const apres = { ...statuts };
    if (statut) apres[id] = statut;
    else delete apres[id];
    setStatuts(apres);
    setErreur(null);
    try {
      // Le texte lu à l'écran part avec le statut : réécrit entre-temps par
      // le n+1, l'objectif est refusé, et la fiche se recharge.
      const empreinte = objectifsDeLaFiche(fiche.contenu).find((o) => o.id === id)?.empreinte;
      const r = await api<{ statuts: Record<string, StatutObjectif> }>(
        `/objectifs/moi/fiches/${fiche.annee}/statuts`,
        { method: 'PUT', body: { id, statut, empreinte } },
      );
      queryClient.setQueryData<MesObjectifs>([...CLE_OBJECTIFS, 'moi'], (d) =>
        d
          ? {
              ...d,
              fiches: d.fiches.map((x) =>
                x.annee === fiche.annee
                  ? {
                      ...x,
                      statuts: r.statuts,
                      statutsCaducs: x.statutsCaducs.filter((c) => c !== id),
                    }
                  : x,
              ),
            }
          : d,
      );
    } catch (e) {
      setStatuts(avant);
      setErreur(e instanceof ApiError ? e.message : 'Statut non enregistré, réessayez.');
      if (e instanceof ApiError && e.problem.code === 'objectifs.objectif_modifie') {
        await queryClient.invalidateQueries({ queryKey: [...CLE_OBJECTIFS, 'moi'] });
      }
    }
  };

  // Une fiche sans case à cocher n'a rien à auto-évaluer.
  const envoyee = Boolean(fiche.evaluation.envoyesLe);
  const aEvaluer = envoyee || objectifsDeLaFiche(fiche.contenu).length > 0;
  const ouverture = ouvertureDeLAutoEvaluation(fiche.annee, jourEvaluation);
  const ouverte = envoyee || aujourdhui() >= ouverture;
  const bascule = !aEvaluer ? null : ouverte ? (
    <BoutonAutoEvaluation
      fiche={{ ...fiche, statuts }}
      actif={autoEvaluation}
      onClick={() => setAutoEvaluation((v) => !v)}
    />
  ) : (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-muted">
      <Icon name="schedule" size={15} />
      {/* L'année, quand ce n'est pas celle d'aujourd'hui : une fiche de l'an prochain. */}
      Auto-évaluation dès le{' '}
      {dateEnLettres(ouverture, ouverture.slice(0, 4) !== aujourdhui().slice(0, 4))}
    </span>
  );

  return (
    <FicheAnnuelle
      annee={fiche.annee}
      note={
        <>
          {fiche.auteur ? `${fiche.auteur} · ` : ''}mis à jour le{' '}
          {new Date(fiche.majLe).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
        </>
      }
    >
      {autoEvaluation && aEvaluer && ouverte ? (
        <AutoEvaluationAgent
          fiche={fiche}
          statuts={statuts}
          onStatuer={(id, statut) => void statuer(id, statut)}
          erreurStatut={erreur}
          bascule={bascule}
        />
      ) : (
        <>
          <EditeurFicheObjectifs
            // Le n+1 a changé la fiche, ou la DCH la date : elle se relit.
            key={`${fiche.majLe}-${jourEvaluation}`}
            className="pt-3 pb-1"
            contenu={fiche.contenu}
            modifiable={false}
            annee={fiche.annee}
            jourEvaluation={jourEvaluation}
            // Envoyée, la fiche garde l'état de ses formations à ce jour-là.
            formations={fiche.formations ?? formations}
            statuts={statuts}
            // Envoyée, l'auto-évaluation fige les cases.
            onCocher={
              envoyee
                ? undefined
                : (id) => void statuer(id, statuts[id] === 'atteint' ? null : 'atteint')
            }
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
    </FicheAnnuelle>
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
