'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@teranga/ui';
import { periodeDeLAuto, RetourALAccueil } from '../../../../components/campagne/fiche';
import { EnTete } from '../../../../components/fiche';
import { ACCUEIL_DE_LA_CAMPAGNE, useAccueilDeLaCampagne } from '../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   L'auto-évaluation de la personne connectée (ADR-0214), ouverte par le
   bouton « M’auto-évaluer » de sa fiche. Son en-tête : le titre et la
   période. Le formulaire, les sections de la fiche d'entretien que
   l'agent remplit, viendra dessous. Sans auto-évaluation à faire (au
   sommet de l'organigramme, en stage), la page renvoie à l'accueil.
   ──────────────────────────────────────────────────────────────── */

export default function AutoEvaluationPage() {
  const router = useRouter();
  const { data: v } = useAccueilDeLaCampagne();
  const evalue = Boolean(v?.moi?.auto);

  useEffect(() => {
    if (v && !evalue) router.replace(ACCUEIL_DE_LA_CAMPAGNE);
  }, [v, evalue, router]);

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Accueil" />
      {v && evalue ? (
        <EnTete titre="Mon auto-évaluation" sousTitre={periodeDeLAuto(v.periode)} />
      ) : (
        <Skeleton className="h-[86px] w-full rounded-bloc" />
      )}
    </div>
  );
}
