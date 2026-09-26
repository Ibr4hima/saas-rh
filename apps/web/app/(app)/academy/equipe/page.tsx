'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { TeamMember, TeamView } from '@teranga/contracts';
import { Button, Card, EmptyState, Skeleton } from '@teranga/ui';
import { RetourAcademy } from '../../../../components/academy-carte';
import { EnteteColonnes, LigneAgent } from '../../../../components/academy-equipe';
import { Page } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { LoadFailure } from '../../../../components/load-failure';
import { Onglets } from '../../../../components/onglets-bandeau';
import { api } from '../../../../lib/api';
import { compte } from '../../../../lib/mots';

/* ————————————————————————————————————————————————————————————————
   « Mon équipe » : où en sont, dans l'Academy, ceux qui vous rendent compte.

   L'équipe est celle de l'organigramme, sur toute la chaîne. Elle se range
   PAR RESPONSABLE : vos directs d'abord, puis l'équipe de chacun d'eux — une
   directrice retrouve sa direction telle qu'elle est bâtie. « Directs »
   resserre la vue sur ceux qui vous rendent compte en personne.
   ———————————————————————————————————————————————————————————————— */

interface Groupe {
  cle: string;
  titre: string;
  membres: TeamMember[];
}

function grouper(membres: TeamMember[]): Groupe[] {
  const groupes = new Map<string, Groupe>();
  for (const m of membres) {
    const cle = m.level === 1 ? 'directs' : m.manager.employeeId;
    if (!groupes.has(cle)) {
      groupes.set(cle, {
        cle,
        titre: m.level === 1 ? 'Vos directs' : `Équipe de ${m.manager.name}`,
        membres: [],
      });
    }
    groupes.get(cle)!.membres.push(m);
  }
  // Le serveur range déjà par niveau puis par nom : l'ordre d'arrivée des
  // groupes suit la hiérarchie.
  return [...groupes.values()];
}

export default function MonEquipePage() {
  const [filtre, setFiltre] = useState<'tous' | 'directs'>('tous');
  const equipe = useQuery({
    queryKey: ['academy', 'equipe'],
    queryFn: () => api<TeamView>('/academy/equipe'),
  });

  const membres = equipe.data?.members ?? [];
  const directs = membres.filter((m) => m.level === 1).length;
  const chaine = membres.length > directs;
  const groupes = useMemo(
    () => grouper(filtre === 'directs' ? membres.filter((m) => m.level === 1) : membres),
    [membres, filtre],
  );

  return (
    <Page>
      <RetourAcademy href="/academy" label="APIX Academy" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.14em] text-primary uppercase">
            Mon équipe
          </h2>
          {membres.length > 0 ? (
            <span className="text-[12px] font-semibold text-ink-muted">
              {compte(membres.length, 'agent')}
            </span>
          ) : null}
        </div>
        {/* Sans chaîne sous vos directs, le filtre ne filtrerait rien. */}
        {chaine ? (
          <Onglets
            label="Filtrer l’équipe"
            courant={filtre}
            onChange={(cle) => setFiltre(cle as 'tous' | 'directs')}
            onglets={[
              { cle: 'tous', label: 'Toute l’équipe', compte: membres.length },
              { cle: 'directs', label: 'Directs', compte: directs },
            ]}
          />
        ) : null}
      </div>

      {equipe.isPending ? (
        <Skeleton className="h-[220px] w-full rounded-[16px]" />
      ) : equipe.isError ? (
        <LoadFailure error={equipe.error} onRetry={() => void equipe.refetch()} />
      ) : membres.length === 0 ? (
        <Card className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Icon name="groups" size={22} />}
            title="Personne ne vous rend compte"
            description="Votre équipe se lit dans l’organigramme : les agents dont vous êtes le n+1 apparaîtront ici."
            action={
              <Link href="/academy">
                <Button variant="secondary">Retour au catalogue</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        groupes.map((g) => (
          <section
            key={g.cle}
            aria-labelledby={groupes.length > 1 ? `groupe-${g.cle}` : undefined}
            className="flex flex-col gap-2"
          >
            {/* Sur téléphone, l'en-tête des colonnes disparaît : le nom du
                groupe passe au-dessus de sa carte. Un seul groupe : le titre
                de la page suffit à le nommer. */}
            {groupes.length > 1 ? (
              <h3
                id={`groupe-${g.cle}`}
                className="px-1 text-[12px] font-bold text-ink-muted sm:sr-only"
              >
                {g.titre}
                <span className="ml-2 font-semibold text-ink-muted/70">{g.membres.length}</span>
              </h3>
            ) : null}
            <Card className="shrink-0 px-2 pt-3 pb-1">
              <EnteteColonnes
                titre={groupes.length > 1 ? g.titre : 'Agent'}
                nombre={groupes.length > 1 ? g.membres.length : undefined}
              />
              <ul className="flex flex-col">
                {g.membres.map((m) => (
                  <LigneAgent key={m.employeeId} membre={m} />
                ))}
              </ul>
            </Card>
          </section>
        ))
      )}
    </Page>
  );
}
