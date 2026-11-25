'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ceQuiManqueAuxObjectifs,
  dateEnLettres,
  objectifsEcrits,
  periodeDEvaluationEnLettres,
  type EcritureDesObjectifs,
  type ObjectifsDeLAgent,
} from '@teranga/contracts';
import { Card, EmptyState, Skeleton } from '@teranga/ui';
import { AideAuxObjectifs } from '../../../../../components/campagne/aide-aux-objectifs';
import { CarteDeLaFiche } from '../../../../../components/campagne/auto-evaluation';
import { BandeauDeLAgent } from '../../../../../components/campagne/charte';
import {
  BarreDeTransmission,
  useEnregistrementAuto,
} from '../../../../../components/campagne/enregistrement';
import { RetourALAccueil } from '../../../../../components/campagne/fiche';
import { TableauDesObjectifs } from '../../../../../components/campagne/objectifs';
import { Confirmation, messageDe } from '../../../../../components/grille-evaluation';
import { Icon } from '../../../../../components/icons';
import { api, ApiError } from '../../../../../lib/api';
import { CLE_CAMPAGNE } from '../../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   Les objectifs d'un agent de son équipe, que fixe son N+1 dans
   l'organigramme (ADR-0274), ouverts depuis sa carte sur l'accueil : son
   bandeau, puis ses objectifs de l'année, de trois à cinq, chacun avec son
   indicateur de réussite et son échéance. À côté du titre, l'aide à leur
   rédaction (ADR-0262) ; à droite, la période de leur fixation.
   Chaque modification s'enregistre seule ; la barre au bas de la page dit
   où en est l'enregistrement et porte « Transmettre à l'agent », active une
   fois les objectifs complets. Transmis, ils se lisent et ne changent plus ;
   la période passée, ils se lisent aussi. Cette page ne s'ouvre qu'au N+1
   de l'agent, une fois la fixation des objectifs ouverte.
   ──────────────────────────────────────────────────────────────── */

export default function ObjectifsDeLAgentPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const vue = useQuery({
    queryKey: [...CLE_CAMPAGNE, 'objectifs', employeeId],
    queryFn: () => api<ObjectifsDeLAgent>(`/campagne/objectifs/equipe/${employeeId}`),
    retry: false,
    // La saisie garde son propre état : relire les objectifs au retour sur
    // l'onglet n'apporterait rien.
    refetchOnWindowFocus: false,
  });
  const v = vue.data;

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Objectifs de mon équipe" />
      {vue.error ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="groups" size={22} />}
            title={
              vue.error instanceof ApiError
                ? vue.error.problem.title
                : 'Impossible d’afficher les objectifs de cet agent'
            }
          />
        </Card>
      ) : !v || !vue.isFetchedAfterMount ? (
        // La saisie part de la fiche relue à l'ouverture, jamais d'une copie
        // gardée en mémoire depuis une visite précédente (ADR-0280).
        <>
          <Skeleton className="mb-4 h-[158px] w-full rounded-bloc" />
          <Skeleton className="h-[264px] w-full rounded-bloc" />
        </>
      ) : (
        // Transmis, les objectifs repartent de zéro, en lecture.
        <Objectifs key={v.etat === 'transmis' ? 'transmis' : 'saisie'} vue={v} />
      )}
    </div>
  );
}

/** À droite du titre : « Du 5 au 31 janvier 2027 », puis le jour de leur transmission. */
function aDroite(v: ObjectifsDeLAgent): string {
  if (v.transmisLe) return `Transmis le ${dateEnLettres(v.transmisLe)}`;
  const periode = periodeDEvaluationEnLettres(v.periode);
  return periode.charAt(0).toLocaleUpperCase('fr') + periode.slice(1);
}

function Objectifs({ vue: v }: { vue: ObjectifsDeLAgent }) {
  return (
    <>
      <BandeauDeLAgent agent={v.agent} />
      {v.modifiable ? (
        <Saisie vue={v} />
      ) : (
        <CarteDeLaFiche titre={`Objectifs ${v.annee}`} qui={aDroite(v)}>
          {/* En lecture, sans les lignes laissées vides d'un brouillon. */}
          <TableauDesObjectifs annee={v.annee} objectifs={objectifsEcrits(v.objectifs)} />
        </CarteDeLaFiche>
      )}
    </>
  );
}

/** Le corps d'un envoi : les objectifs, tels qu'ils sont écrits. */
const corpsDesObjectifs = (e: EcritureDesObjectifs) => e;

/** Les objectifs, tels que le serveur les rend après un enregistrement. */
const lireLesObjectifs = (r: unknown): EcritureDesObjectifs => ({
  objectifs: (r as ObjectifsDeLAgent).objectifs,
});

/** Les objectifs à écrire, qui s'enregistrent seuls, puis se transmettent à l'agent. */
function Saisie({ vue: v }: { vue: ObjectifsDeLAgent }) {
  const qc = useQueryClient();
  const chemin = `/campagne/objectifs/equipe/${v.agent.employeeId}`;
  const { valeur, etat, changer, vider, contenu } = useEnregistrementAuto(
    chemin,
    { objectifs: v.objectifs },
    corpsDesObjectifs,
    { lire: lireLesObjectifs },
  );
  const [confirmer, setConfirmer] = useState(false);
  const manque = ceQuiManqueAuxObjectifs(valeur.objectifs, v.annee);

  const transmettre = useMutation({
    mutationFn: async () => {
      await vider();
      return api<ObjectifsDeLAgent>(`${chemin}/transmission`, {
        method: 'POST',
        body: contenu(),
      });
    },
    onSuccess: async (vue) => {
      qc.setQueryData([...CLE_CAMPAGNE, 'objectifs', v.agent.employeeId], vue);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  return (
    <>
      <CarteDeLaFiche titre={`Objectifs ${v.annee}`} aCote={<AideAuxObjectifs />} qui={aDroite(v)}>
        <TableauDesObjectifs
          annee={v.annee}
          objectifs={valeur.objectifs}
          onChange={(objectifs) => changer(() => ({ objectifs }))}
        />
      </CarteDeLaFiche>
      <BarreDeTransmission
        etat={etat}
        manque={manque}
        libelle="Transmettre à l’agent"
        enCours={transmettre.isPending}
        onTransmettre={() => setConfirmer(true)}
      />
      {confirmer ? (
        <Confirmation
          titre="Transmettre les objectifs ?"
          libelle="Transmettre"
          enCours={transmettre.isPending}
          erreur={transmettre.error ? messageDe(transmettre.error) : null}
          onConfirmer={() => transmettre.mutate()}
          onClose={() => {
            setConfirmer(false);
            transmettre.reset();
          }}
        >
          Les objectifs {v.annee} seront transmis à{' '}
          <span className="font-semibold text-ink-strong">
            {v.agent.prenom} {v.agent.nom}
          </span>
          . Ils ne pourront plus être modifiés.
        </Confirmation>
      ) : null}
    </>
  );
}
