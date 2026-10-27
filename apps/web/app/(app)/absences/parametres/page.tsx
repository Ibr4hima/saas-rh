'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AbsenceType, Continuite } from '@teranga/contracts';
import {
  ANNEES_MAX_PAR_DEMANDE,
  CONTINUITE_LABELS,
  continuiteSchema,
  peut,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Select,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@teranga/ui';
import { Icon } from '../../../../components/icons';
import { Pagination, usePagination } from '../../../../components/pagination';
import { Modal, ModalGrid, ModalSection } from '../../../../components/modal';
import {
  Actions,
  FenetreSuppression,
  messageErreur,
} from '../../../../components/reglages-absences';
import { api } from '../../../../lib/api';
import { useMe } from '../../../../lib/hooks';
import { CartePleine, CorpsDefilant, Page } from '../../../../components/gabarit';
import { SqueletteTableau } from '../../../../components/tableau';

// =============================================================================
// Page
// =============================================================================

export default function AbsenceSettingsPage() {
  const me = useMe();
  const peutGerer = peut(me.data, 'conges.parametres');

  return (
    <Page>
      {/* Le catalogue des types prend la hauteur qui reste ; le circuit, qui
          tient en deux listes, garde la sienne. */}
      <TypesCard peutGerer={peutGerer} />
      <CircuitCard />
    </Page>
  );
}

// =============================================================================
// Types d'absences
// =============================================================================

/** Un type a un quota annuel, ou n'en a pas : la maternité s'ouvre à la naissance. */
function TypesCard({ peutGerer }: { peutGerer: boolean }) {
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: ['absence-types'],
    queryFn: () => api<AbsenceType[]>('/absence-types'),
  });
  const [edition, setEdition] = useState<AbsenceType | 'nouveau' | null>(null);
  const [aSupprimer, setASupprimer] = useState<AbsenceType | null>(null);

  const rafraichir = () => {
    void queryClient.invalidateQueries({ queryKey: ['absence-types'] });
    void queryClient.invalidateQueries({ queryKey: ['balances'] });
  };

  const liste = types.data ?? [];
  const { tranche, barre } = usePagination(liste);

  return (
    <CartePleine>
      <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <CardTitle>Types d&apos;absences</CardTitle>
        {peutGerer ? (
          <Button size="sm" onClick={() => setEdition('nouveau')}>
            <Icon name="add" size={15} className="-ml-0.5" />
            Ajouter un type
          </Button>
        ) : null}
      </CardHeader>

      {types.isLoading ? (
        <CorpsDefilant>
          <SqueletteTableau />
        </CorpsDefilant>
      ) : liste.length === 0 ? (
        <CorpsDefilant className="grid place-items-center">
          <EmptyState
            icon={<Icon name="event_busy" size={22} />}
            title="Aucun type d’absence"
            description="Créez le premier type : congé annuel, maladie, mission…"
            action={
              peutGerer ? (
                <Button size="sm" onClick={() => setEdition('nouveau')}>
                  Ajouter un type
                </Button>
              ) : undefined
            }
          />
        </CorpsDefilant>
      ) : (
        <>
          <Table pleine>
            <THead>
              <tr>
                <Th>Type d&apos;absence</Th>
                <Th>Quota</Th>
                <Th>Durée max</Th>
                <Th>Règles</Th>
                {peutGerer ? <Th className="w-20 text-right">Actions</Th> : null}
              </tr>
            </THead>
            <TBody>
              {tranche.map((t) => (
                <Tr key={t.id} className="group">
                  <Td className="font-semibold text-ink-strong">{t.name}</Td>
                  <Td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {t.frequency === 'annual' && t.allowanceDays != null ? (
                      <>
                        {t.allowanceDays} <span className="text-ink-muted">j par an</span>
                      </>
                    ) : (
                      <span className="text-ink-muted">Sans quota</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {t.maxDaysPerRequest != null ? (
                      <>
                        {t.maxDaysPerRequest}{' '}
                        <span className="text-ink-muted">
                          {t.maxDaysPerRequest > 1 ? 'j ouvrés' : 'j ouvré'}
                        </span>
                      </>
                    ) : t.maxYearsPerRequest != null ? (
                      <>
                        {t.maxYearsPerRequest}{' '}
                        <span className="text-ink-muted">
                          {t.maxYearsPerRequest > 1 ? 'ans' : 'an'}
                          {t.renouvelable ? ' renouvelable' : ''}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-muted">Sans plafond</span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.deductsBalance ? (
                        <Badge tone="bleu">Décompté du solde</Badge>
                      ) : (
                        <Badge tone="gris">Non décompté</Badge>
                      )}
                      {t.allowsHours ? <Badge tone="bleu">À l’heure</Badge> : null}
                      {t.requiresDocument ? <Badge tone="orange">Justificatif</Badge> : null}
                      {t.resteJoignable ? <Badge tone="teal">Joignable</Badge> : null}
                      {t.motifConfidentiel ? <Badge tone="prune">Confidentiel</Badge> : null}
                      {t.continuite === 'jamais' ? null : (
                        <Badge tone="orange">
                          {t.continuite === 'toujours'
                            ? 'Continuité'
                            : 'Continuité au-delà d’un jour'}
                        </Badge>
                      )}
                    </div>
                  </Td>
                  {peutGerer ? (
                    <Td className="text-right">
                      <Actions
                        nom={t.name}
                        onModifier={() => setEdition(t)}
                        onSupprimer={() => setASupprimer(t)}
                      />
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </TBody>
          </Table>
          <Pagination {...barre} className="py-4" />
        </>
      )}
      {edition ? (
        <FenetreType
          cible={edition === 'nouveau' ? null : edition}
          onClose={() => setEdition(null)}
          onEnregistre={() => {
            setEdition(null);
            rafraichir();
          }}
        />
      ) : null}

      {aSupprimer ? (
        <FenetreSuppression
          titre="Retirer ce type d’absence"
          nom={aSupprimer.name}
          bouton="Retirer le type"
          chemin={`/absence-types/${aSupprimer.id}`}
          onClose={() => setASupprimer(null)}
          onSupprime={() => {
            setASupprimer(null);
            rafraichir();
          }}
        >
          <p className="text-[12.5px] leading-relaxed text-ink">
            Ce type n’apparaîtra plus dans le formulaire de demande.
          </p>
          {aSupprimer.usageCount > 0 ? (
            <p className="mt-3 rounded-bloc bg-bg px-3 py-2 text-[12px] text-ink-muted">
              {aSupprimer.usageCount === 1
                ? 'La demande déjà faite avec ce type est conservée, avec son historique.'
                : `Les ${aSupprimer.usageCount} demandes déjà faites avec ce type sont conservées, avec leur historique.`}
            </p>
          ) : null}
        </FenetreSuppression>
      ) : null}
    </CartePleine>
  );
}

type BrouillonType = {
  name: string;
  /** Vide : sans quota. */
  allowanceDays: string;
  deductsBalance: boolean;
  requiresDocument: boolean;
  resteJoignable: boolean;
  motifConfidentiel: boolean;
  allowsHours: boolean;
  /** Vide : sans plafond. */
  dureeMax: string;
  /** La durée max se donne en jours ouvrés ou en années (ADR-0135). */
  uniteDureeMax: UniteDureeMax;
  /** Une durée max en années se renouvelle, ou non. */
  renouvelable: boolean;
  continuite: Continuite;
};

type UniteDureeMax = 'jours_ouvres' | 'ans';

/** Les bornes d'une durée max, selon son unité. */
const BORNES_DE_LA_DUREE_MAX: Record<UniteDureeMax, { max: number; message: string }> = {
  jours_ouvres: { max: 365, message: 'Entre 1 et 365 jours ouvrés' },
  ans: { max: ANNEES_MAX_PAR_DEMANDE, message: `Entre 1 et ${ANNEES_MAX_PAR_DEMANDE} ans` },
};

function FenetreType({
  cible,
  onClose,
  onEnregistre,
}: {
  cible: AbsenceType | null;
  onClose: () => void;
  onEnregistre: () => void;
}) {
  const [form, setForm] = useState<BrouillonType>({
    name: cible?.name ?? '',
    allowanceDays: cible?.allowanceDays == null ? '' : String(cible.allowanceDays),
    deductsBalance: cible?.deductsBalance ?? false,
    requiresDocument: cible?.requiresDocument ?? false,
    resteJoignable: cible?.resteJoignable ?? false,
    motifConfidentiel: cible?.motifConfidentiel ?? false,
    allowsHours: cible?.allowsHours ?? false,
    dureeMax: String(cible?.maxDaysPerRequest ?? cible?.maxYearsPerRequest ?? ''),
    uniteDureeMax: cible?.maxYearsPerRequest != null ? 'ans' : 'jours_ouvres',
    renouvelable: cible?.renouvelable ?? false,
    continuite: cible?.continuite ?? 'jamais',
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const set = <K extends keyof BrouillonType>(k: K, v: BrouillonType[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const avecQuota = form.allowanceDays.trim() !== '';
  const decompte = avecQuota && form.deductsBalance;
  const plafond = form.dureeMax.trim();
  const bornes = BORNES_DE_LA_DUREE_MAX[form.uniteDureeMax];
  const plafondInvalide =
    plafond !== '' &&
    !(Number.isInteger(Number(plafond)) && Number(plafond) >= 1 && Number(plafond) <= bornes.max);
  const enAnnees = form.uniteDureeMax === 'ans';
  // Seule une durée max en années se renouvelle.
  const renouvelable = form.renouvelable && enAnnees && plafond !== '';
  const nomTropCourt = form.name.trim().length < 2;
  const annee = new Date().getFullYear();

  const enregistrer = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        // Seul un quota se décompte : sans lui, toute demande serait refusée.
        deductsBalance: decompte,
        allowanceDays: avecQuota ? Number(form.allowanceDays) : null,
        frequency: avecQuota ? 'annual' : 'none',
        requiresDocument: form.requiresDocument,
        resteJoignable: form.resteJoignable,
        motifConfidentiel: form.motifConfidentiel,
        // Ce qui se décompte du solde se prend à la journée.
        allowsHours: form.allowsHours && !decompte,
        maxDaysPerRequest: plafond === '' || enAnnees ? null : Number(plafond),
        maxYearsPerRequest: plafond === '' || !enAnnees ? null : Number(plafond),
        renouvelable,
        continuite: form.continuite,
      };
      return cible
        ? api(`/absence-types/${cible.id}`, { method: 'PATCH', body })
        : api('/absence-types', { method: 'POST', body });
    },
    onSuccess: onEnregistre,
    onError: (err) => setErreur(messageErreur(err, 'Enregistrement impossible.')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={cible ? 'Modifier le type d’absence' : 'Nouveau type d’absence'}
      // En composant, pas en texte : la phrase passe à la ligne au lieu d'être coupée.
      subtitle={
        <p className="text-xs text-ink-muted">
          {cible
            ? `Les modifications s’appliquent à partir de ${annee}. Les années précédentes ne changent pas.`
            : 'Il apparaîtra aussitôt dans le formulaire de demande.'}
        </p>
      }
      maxWidth="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={nomTropCourt || plafondInvalide}
            loading={enregistrer.isPending}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            {cible ? 'Enregistrer' : 'Ajouter le type'}
          </Button>
        </>
      }
    >
      {erreur ? (
        <p className="rounded-bloc bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{erreur}</p>
      ) : null}

      <ModalSection title="Intitulé">
        <Field label="Type d’absence" htmlFor="typeName" required>
          <Input
            id="typeName"
            autoFocus
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Ex : Congé exceptionnel"
          />
        </Field>
      </ModalSection>

      <ModalSection title="Droit annuel">
        <ModalGrid>
          <Field label="Jours par an" htmlFor="typeDays">
            <Input
              id="typeDays"
              type="number"
              min={0}
              max={365}
              step={0.5}
              value={form.allowanceDays}
              onChange={(e) => set('allowanceDays', e.target.value)}
              placeholder="Sans quota"
            />
          </Field>
          <Field
            label="Durée max par demande"
            htmlFor="typeMax"
            error={plafondInvalide ? bornes.message : undefined}
          >
            <div className="flex gap-2">
              <Input
                id="typeMax"
                type="number"
                min={1}
                max={bornes.max}
                step={1}
                value={form.dureeMax}
                onChange={(e) => set('dureeMax', e.target.value)}
                placeholder="Sans plafond"
                aria-describedby={plafondInvalide ? 'typeMax-message' : undefined}
                className="min-w-0 flex-1"
              />
              <Select
                aria-label="Unité de la durée max"
                value={form.uniteDureeMax}
                onChange={(e) => set('uniteDureeMax', e.target.value as UniteDureeMax)}
                className="w-[136px]"
              >
                <option value="jours_ouvres">Jours ouvrés</option>
                <option value="ans">Ans</option>
              </Select>
            </div>
          </Field>
        </ModalGrid>
        {/* Une durée en années se renouvelle : l'agent demande la période suivante. */}
        <label className="mt-3.5 flex items-start gap-2.5 text-[12.5px] text-ink">
          <Checkbox
            className="mt-0.5"
            checked={renouvelable}
            disabled={!enAnnees || plafond === ''}
            onChange={(e) => set('renouvelable', e.target.checked)}
          />
          <span className="font-semibold text-ink-strong">Durée max renouvelable</span>
        </label>
      </ModalSection>

      <ModalSection title="Règles">
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
            <Checkbox
              className="mt-0.5"
              checked={decompte}
              disabled={!avecQuota || form.allowsHours}
              onChange={(e) => set('deductsBalance', e.target.checked)}
            />
            <span>
              <span className="font-semibold text-ink-strong">Décompté du solde</span>
              <span className="block text-ink-muted">
                Les jours pris sont déduits du solde. Sinon, l’absence est seulement enregistrée.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
            <Checkbox
              className="mt-0.5"
              checked={form.requiresDocument}
              onChange={(e) => set('requiresDocument', e.target.checked)}
            />
            <span>
              <span className="font-semibold text-ink-strong">Justificatif obligatoire</span>
              <span className="block text-ink-muted">
                La demande ne peut être validée qu’avec un justificatif (certificat, ordre de
                mission…).
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
            <Checkbox
              className="mt-0.5"
              checked={form.allowsHours && !decompte}
              disabled={decompte}
              onChange={(e) => set('allowsHours', e.target.checked)}
            />
            <span className="font-semibold text-ink-strong">Peut aussi être demandé à l’heure</span>
          </label>
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
            <Checkbox
              className="mt-0.5"
              checked={form.resteJoignable}
              onChange={(e) => set('resteJoignable', e.target.checked)}
            />
            <span className="font-semibold text-ink-strong">Joignable pendant l’absence</span>
          </label>
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
            <Checkbox
              className="mt-0.5"
              checked={form.motifConfidentiel}
              onChange={(e) => set('motifConfidentiel', e.target.checked)}
            />
            <span className="font-semibold text-ink-strong">Motif réservé à la DCH</span>
          </label>
        </div>
        <div className="mt-4 sm:max-w-[50%]">
          <Field label="Continuité du service" htmlFor="typeContinuite">
            <Select
              id="typeContinuite"
              value={form.continuite}
              onChange={(e) => set('continuite', continuiteSchema.parse(e.target.value))}
            >
              {continuiteSchema.options.map((c) => (
                <option key={c} value={c}>
                  {CONTINUITE_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </ModalSection>
    </Modal>
  );
}

// =============================================================================
// Circuit d'approbation
// =============================================================================

/**
 * Le circuit, tel que l'APIX l'a fixé. Il ne se règle pas ici : « qui valide
 * mes congés ? » a une seule réponse, lue dans l'organigramme. La carte le
 * DIT, pour que personne ne cherche le réglage.
 */
function CircuitCard() {
  const etapes = ['Le N+1 de l’agent', 'La Direction du Capital Humain'];
  return (
    <Card className="shrink-0">
      <CardHeader>
        <CardTitle>Circuit de validation</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2">
          {etapes.map((titre, i) => (
            <li key={titre} className="flex items-center gap-2.5 rounded-bloc bg-bg px-3.5 py-3">
              <span className="flex size-[20px] shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-[10.5px] font-bold text-primary">
                {i + 1}
              </span>
              <span className="min-w-0 text-[12.5px] font-semibold text-ink-strong">{titre}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
