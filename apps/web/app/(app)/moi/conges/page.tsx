'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type {
  AbsenceRequestView,
  AbsenceType,
  BalanceView,
  MyEmployeeView,
} from '@teranga/contracts';
import { Skeleton } from '@teranga/ui';
import { FenetreRenouvellement } from '../../../../components/conge-valide';
import { BlocQuiOuvre, EnTete, Repere } from '../../../../components/fiche';
import { aujourdhui, FenetreDemandeAbsence } from '../../../../components/fenetre-demande-absence';
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
  const queryClient = useQueryClient();
  const [ouverte, setOuverte] = useState(false);
  const [envoyee, setEnvoyee] = useState<string | null>(null);
  const [renouvellementOuvert, setRenouvellementOuvert] = useState(false);
  const [renouvellementEnvoye, setRenouvellementEnvoye] = useState<{
    du: string;
    au: string;
  } | null>(null);

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
  // Une période en cours qui se renouvelle (la disponibilité, ADR-0135) :
  // l'agent demande la suivante depuis ici, jusqu'à son dernier jour.
  const demandes = useQuery({
    queryKey: ['my-requests', employeeId],
    queryFn: () =>
      api<AbsenceRequestView[]>(`/absence-requests?employeeId=${employeeId}&limit=100`),
    enabled: Boolean(employeeId),
  });
  const types = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => api<AbsenceType[]>('/absence-types'),
    enabled: Boolean(employeeId),
  });
  const aRenouveler = (demandes.data ?? []).find(
    (r) => r.employeeId === employeeId && r.gestes.renouveler,
  );
  const anneesMax =
    (types.data ?? []).find((t) => t.id === aRenouveler?.absenceTypeId)?.maxYearsPerRequest ?? null;

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

      <BlocQuiOuvre
        titre="Poser une demande"
        disabled={!employeeId}
        onOuvrir={() => {
          setEnvoyee(null);
          setOuverte(true);
        }}
        envoi={
          envoyee !== null ? (
            <>
              Demande envoyée : {envoyee}.{' '}
              <Link href="/moi/conges/historique" className="underline">
                Voir l&apos;historique
              </Link>
            </>
          ) : null
        }
      />

      {(aRenouveler && anneesMax) || renouvellementEnvoye ? (
        <BlocQuiOuvre
          titre="Demander un renouvellement"
          disabled={!aRenouveler || !anneesMax}
          onOuvrir={() => {
            setRenouvellementEnvoye(null);
            setRenouvellementOuvert(true);
          }}
          envoi={
            renouvellementEnvoye ? (
              <>
                Demande envoyée : renouvellement du {formatDate(renouvellementEnvoye.du)} au{' '}
                {formatDate(renouvellementEnvoye.au)}.{' '}
                <Link href="/moi/conges/historique" className="underline">
                  Voir l&apos;historique
                </Link>
              </>
            ) : null
          }
        />
      ) : null}

      {renouvellementOuvert && aRenouveler && anneesMax ? (
        <FenetreRenouvellement
          demande={aRenouveler}
          anneesMax={anneesMax}
          onClose={() => setRenouvellementOuvert(false)}
          onFait={(periode) => {
            setRenouvellementOuvert(false);
            setRenouvellementEnvoye(periode);
            void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
          }}
        />
      ) : null}

      {ouverte && employeeId ? (
        <FenetreDemandeAbsence
          employeeId={employeeId}
          stagiaire={stagiaire}
          onClose={() => setOuverte(false)}
          onEnvoyee={(duree) => {
            setOuverte(false);
            setEnvoyee(duree);
          }}
        />
      ) : null}
    </Page>
  );
}
