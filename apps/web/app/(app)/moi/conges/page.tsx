'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { BalanceView, MyEmployeeView } from '@teranga/contracts';
import { Card, CardHeader, CardTitle, Skeleton } from '@teranga/ui';
import { EnTete, Repere } from '../../../../components/fiche';
import { aujourdhui, FenetreDemandeAbsence } from '../../../../components/fenetre-demande-absence';
import { Icon } from '../../../../components/icons';
import { Page } from '../../../../components/gabarit';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/hooks';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   Poser une demande — la même grammaire que « Mes infos personnelles » :
   une carte de tête (le solde de l'année, en repères), puis le bloc qui
   ouvre la fiche de la demande.
   ———————————————————————————————————————————————————————————————— */

export default function PoserUneDemandePage() {
  const [ouverte, setOuverte] = useState(false);
  const [envoyee, setEnvoyee] = useState<number | null>(null);

  const myEmployee = useQuery({
    queryKey: ['me-employee'],
    queryFn: () => api<MyEmployeeView>('/me/employee'),
    retry: false,
  });
  const employeeId = myEmployee.data?.employeeId;

  const annee = aujourdhui().slice(0, 4);
  const balances = useQuery({
    queryKey: ['balances', employeeId, annee],
    queryFn: () => api<BalanceView[]>(`/employees/${employeeId}/balances?year=${annee}`),
    enabled: Boolean(employeeId),
  });
  // Le solde qui se décompte : le congé annuel, en pratique. Un stagiaire
  // n'en a pas.
  const stagiaire = Boolean(myEmployee.data?.stagiaire);
  const solde = stagiaire
    ? undefined
    : (balances.data ?? []).find((b) => b.deductsBalance && !b.retire);

  return (
    <Page>
      <EnTete
        titre={solde ? `${solde.absenceTypeName} ${solde.year}` : 'Absences & Congés'}
        sousTitre={stagiaire ? undefined : `Solde au ${formatDate(aujourdhui())}`}
        colonnes={3}
        reperes={
          stagiaire ? null : balances.isLoading || !employeeId ? (
            <>
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="mt-2.5 h-4 w-20" />
                </div>
              ))}
            </>
          ) : solde ? (
            <>
              <Repere label="Droit" valeur={compte(solde.entitledDays, 'jour')} />
              <Repere label="Pris" valeur={compte(solde.takenDays, 'jour')} />
              <Repere label="Restant" valeur={compte(solde.remainingDays, 'jour')} />
            </>
          ) : null
        }
      />

      {/* ———— Le bloc qui ouvre la fiche de la demande ———— */}
      <Card>
        <CardHeader className="p-0">
          <button
            type="button"
            disabled={!employeeId}
            onClick={() => {
              setEnvoyee(null);
              setOuverte(true);
            }}
            className="group flex w-full items-center gap-3 px-5 py-4 text-left focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          >
            <CardTitle className="min-w-0 flex-1">Poser une demande</CardTitle>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors duration-200 group-hover:border-primary/40 group-hover:bg-primary/[0.06] group-hover:text-primary">
              <Icon name="add" size={18} />
            </span>
          </button>
        </CardHeader>
        {envoyee !== null ? (
          <p
            role="status"
            className="flex items-start gap-2 border-t border-line-soft px-5 py-3.5 text-[12.5px] font-semibold text-success"
          >
            <Icon name="check_circle" size={15} className="mt-px shrink-0" />
            <span>
              Demande envoyée : {compte(envoyee, 'jour')}.{' '}
              <Link href="/moi/conges/historique" className="underline">
                Voir l&apos;historique
              </Link>
            </span>
          </p>
        ) : null}
      </Card>

      {ouverte && employeeId ? (
        <FenetreDemandeAbsence
          employeeId={employeeId}
          stagiaire={stagiaire}
          onClose={() => setOuverte(false)}
          onEnvoyee={(jours) => {
            setOuverte(false);
            setEnvoyee(jours);
          }}
        />
      ) : null}
    </Page>
  );
}
