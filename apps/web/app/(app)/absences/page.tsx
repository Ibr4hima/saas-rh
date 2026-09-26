'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AbsenceRequestView } from '@teranga/contracts';
import {
  Badge,
  Card,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, ApiError, apiUrl } from '../../../lib/api';
import { type ViewableDoc } from '../../../components/doc-viewer';
import { FenetreDocument } from '../../../components/fenetre-document';
import { resumeVisas, visaAttendu } from '../../../lib/absences';
import { BoutonDecision } from '../../../components/bouton-decision';
import { StatutAbsence } from '../../../components/statut-absence';
import { formatDate, useMe } from '../../../lib/hooks';
import { Icon } from '../../../components/icons';
import { CartePleine, CorpsDefilant, Page } from '../../../components/gabarit';
import { SqueletteTableau, ThTri, useTriLocal } from '../../../components/tableau';

export default function AbsencesPage() {
  const queryClient = useQueryClient();
  const me = useMe();
  const [status, setStatus] = useState('pending');
  const [actionError, setActionError] = useState<string | null>(null);

  const requests = useQuery({
    queryKey: ['absence-requests', status],
    queryFn: () =>
      api<AbsenceRequestView[]>(`/absence-requests${status ? `?status=${status}` : ''}`),
  });
  // Le jour courant dans le calendrier LOCAL : `toISOString()` donnerait la
  // date UTC, et une absence basculerait « en cours » un jour trop tôt ou trop
  // tard selon le fuseau.
  const maintenant = new Date();
  const p2 = (v: number) => String(v).padStart(2, '0');
  const aujourdhui = `${maintenant.getFullYear()}-${p2(maintenant.getMonth() + 1)}-${p2(maintenant.getDate())}`;

  const upcoming = useQuery({
    queryKey: ['absences-upcoming'],
    queryFn: () => api<AbsenceRequestView[]>('/absences/upcoming'),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['absence-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['absences-upcoming'] });
    // Le badge du menu compte ce qui attend la RH : il redescend tout de suite.
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      api(`/absence-requests/${id}/decision`, { method: 'POST', body: { decision } }),
    onSuccess: refresh,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Action impossible.'),
  });
  const canManage = me.data && ['admin', 'hr'].includes(me.data.role);
  const [viewedDoc, setViewedDoc] = useState<ViewableDoc | null>(null);
  /**
   * L'ordre des demandes : les plus anciennes d'abord — une demande qui
   * attend depuis dix jours passe avant celle d'hier. Le reste au clic.
   */
  const tri = useTriLocal(
    requests.data ?? [],
    {
      employeeName: (r) => r.employeeName,
      absenceTypeName: (r) => r.absenceTypeName,
      startDate: (r) => r.startDate,
      daysCount: (r) => r.daysCount,
    },
    { colonne: 'startDate', sens: 'asc' },
    { startDate: 'asc', daysCount: 'desc', employeeName: 'asc', absenceTypeName: 'asc' },
  );
  const items = tri.lignes;

  return (
    <Page>
      {actionError ? (
        <p className="shrink-0 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {actionError}
        </p>
      ) : null}

      <CartePleine>
        <CardHeader className="flex shrink-0 items-center justify-between">
          <CardTitle>Demandes</CardTitle>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 w-40">
            <option value="pending">En attente</option>
            <option value="approved">Approuvées</option>
            <option value="rejected">Refusées</option>
            <option value="cancelled">Annulées</option>
            <option value="">Toutes</option>
          </Select>
        </CardHeader>
        {requests.isLoading ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : items.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="free_cancellation" size={22} />}
              title="Aucune demande dans ce statut"
              description="Les employés posent leurs demandes depuis leur portail. Leur N+1 les vise d’abord ; la DCH les traite ensuite. Toutes s’affichent ici."
            />
          </CorpsDefilant>
        ) : (
          <Table pleine>
            <THead>
              <tr>
                <ThTri
                  label="Employé"
                  colonne="employeeName"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Type"
                  colonne="absenceTypeName"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Période"
                  colonne="startDate"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                />
                <ThTri
                  label="Jours"
                  colonne="daysCount"
                  courant={tri.colonne}
                  sens={tri.sens}
                  onTrier={tri.trier}
                  droite
                />
                <Th>Justificatif</Th>
                <Th>Statut</Th>
                <Th className="text-right">Décision</Th>
              </tr>
            </THead>
            <TBody>
              {items.map((r) => (
                <Tr key={r.id}>
                  <Td className="font-semibold text-ink-strong">
                    {r.employeeName}
                    <span className="mt-0.5 block font-mono text-[10.5px] font-normal text-ink-muted">
                      {r.employeeNumber}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">{r.absenceTypeName}</Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {formatDate(r.startDate)} <span className="text-ink-muted">→</span>{' '}
                    {formatDate(r.endDate)}
                  </Td>
                  <Td className="text-right font-semibold tabular-nums">{r.daysCount}</Td>
                  <Td>
                    {r.documentName && canManage ? (
                      <button
                        type="button"
                        onClick={() =>
                          setViewedDoc({
                            url: apiUrl(`/absence-requests/${r.id}/document`),
                            filename: r.documentName!,
                            contentType: 'application/pdf',
                            // Ce que la pièce EST : le nom du fichier, lui,
                            // est le classement de l'employé qui l'a déposée.
                            titre: 'Justificatif',
                          })
                        }
                        title={r.documentName}
                        className="inline-flex items-center rounded-full border border-line px-2.5 py-[3px] text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                      >
                        Prévisualiser
                      </button>
                    ) : (
                      // Un tiret, pas une case vide : « rien à joindre » se dit,
                      // sinon la colonne a l'air de n'avoir pas fini de charger.
                      <span className="text-ink-muted/60">—</span>
                    )}
                  </Td>
                  <Td>
                    <StatutAbsence statut={r.status} titre={resumeVisas(r)} />
                    {/* L'étape attendue : on lit d'un coup d'œil ce qui attend
                        le N+1, et ce qui attend la DCH — et qui. */}
                    {visaAttendu(r) ? (
                      <span
                        className={cn(
                          'mt-1 block text-[11px] whitespace-nowrap',
                          r.canDecide ? 'font-semibold text-ink' : 'text-ink-muted',
                        )}
                      >
                        {visaAttendu(r)}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    {r.canDecide ? (
                      <div className="flex justify-end gap-1.5">
                        <BoutonDecision
                          geste="approuver"
                          employe={r.employeeName}
                          enCours={
                            decide.isPending &&
                            decide.variables?.id === r.id &&
                            decide.variables.decision === 'approved'
                          }
                          bloque={decide.isPending}
                          onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}
                        />
                        <BoutonDecision
                          geste="refuser"
                          employe={r.employeeName}
                          enCours={
                            decide.isPending &&
                            decide.variables?.id === r.id &&
                            decide.variables.decision === 'rejected'
                          }
                          bloque={decide.isPending}
                          onClick={() => decide.mutate({ id: r.id, decision: 'rejected' })}
                        />
                      </div>
                    ) : (
                      // Un tiret plutôt qu'une case vide, comme la colonne
                      // « Justificatif » : rien à décider ici SE DIT.
                      <p className="text-right text-ink-muted/60">—</p>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CartePleine>

      {/* L'horizon des absences : un complément, pas la file de travail. Il
          garde donc sa taille — c'est la carte du haut qui prend la place. */}
      <Card className="shrink-0">
        <CardHeader>
          <CardTitle>Calendrier des absences</CardTitle>
        </CardHeader>
        {upcoming.isLoading ? (
          <SqueletteTableau lignes={3} />
        ) : (upcoming.data ?? []).length === 0 ? (
          // Le même état vide que sur le tableau de bord, qui dit la même
          // chose : une phrase grise dans une carte à plat se lisait comme
          // une panne, pas comme une bonne nouvelle.
          <EmptyState
            icon={<Icon name="event_busy" size={22} />}
            title="Personne d'absent à l'horizon"
            description="Aucune absence approuvée dans les 30 prochains jours."
            className="py-8"
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Nom</Th>
                <Th>Type</Th>
                <Th>Début</Th>
                <Th>Fin</Th>
                <Th className="text-right">Jours</Th>
                <Th>Statut</Th>
              </tr>
            </THead>
            <TBody>
              {upcoming.data!.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <p className="font-medium text-ink-strong">{r.employeeName}</p>
                    {r.workEmail ? <p className="text-xs text-ink-muted">{r.workEmail}</p> : null}
                  </Td>
                  <Td>{r.absenceTypeName}</Td>
                  <Td className="whitespace-nowrap">{formatDate(r.startDate)}</Td>
                  <Td className="whitespace-nowrap">{formatDate(r.endDate)}</Td>
                  <Td className="text-right font-mono">{r.daysCount}</Td>
                  <Td>
                    {r.startDate <= aujourdhui ? (
                      <Badge tone="success" className="whitespace-nowrap">
                        En cours
                      </Badge>
                    ) : (
                      <Badge tone="primary" className="whitespace-nowrap">
                        À venir
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <FenetreDocument doc={viewedDoc} onClose={() => setViewedDoc(null)} />
    </Page>
  );
}
