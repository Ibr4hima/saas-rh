'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type {
  AbsenceFrequency,
  AbsenceType,
  ApprovalChain,
  Holiday,
  MembershipRole,
} from '@teranga/contracts';
import { ABSENCE_FREQUENCY_LABELS, SENEGAL_MOBILE_HOLIDAYS } from '@teranga/contracts';
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
  Skeleton,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
} from '@teranga/ui';
import { Icon } from '../../../../components/icons';
import { Modal, ModalGrid, ModalSection } from '../../../../components/modal';
import { ROLE_LABELS } from '../../../../lib/absences';
import { api, ApiError } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';

const CHAIN_ROLES: MembershipRole[] = ['manager', 'hr', 'payroll', 'admin'];

/** Dakar vit à UTC : la date du jour se lit sans décalage. */
function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'] as const;

function jourSemaine(iso: string): string {
  // La chaîne sans fuseau se lit comme une date locale : le jour de la semaine
  // est celui du calendrier, quel que soit le fuseau du poste.
  return JOURS[new Date(`${iso}T00:00:00`).getDay()] ?? '';
}

/** Le statut se lit en toutes lettres : quatre états, pas quatre pastilles. */
function statutDuJour(
  jourFerie: string | null,
  aujourdhui: string,
): { texte: string; classe: string } {
  if (jourFerie == null) return { texte: 'À dater', classe: 'text-ink-muted' };
  if (jourFerie === aujourdhui) return { texte: 'En cours', classe: 'font-semibold text-primary' };
  if (jourFerie < aujourdhui) return { texte: 'Passé', classe: 'text-ink-muted' };
  return { texte: 'À venir', classe: 'text-ink' };
}

function messageErreur(err: unknown, defaut: string): string {
  return err instanceof ApiError ? err.message : defaut;
}

// =============================================================================
// Page
// =============================================================================

export default function AbsenceSettingsPage() {
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const peutGerer = isAdmin || me.data?.role === 'hr';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link href="/absences" className="text-sm text-ink-muted hover:text-ink">
          ← Congés
        </Link>
      </div>

      <div className="flex flex-col gap-6">
        <TypesCard peutGerer={peutGerer} />
        <FeriesCard peutGerer={peutGerer} />
        <CircuitCard isAdmin={isAdmin} />
      </div>
    </div>
  );
}

// =============================================================================
// Types d'absences
// =============================================================================

/**
 * Un quota se lit toujours avec sa cadence : « 30 » ne veut rien dire, « 30 par
 * an » se comprend. Les deux colonnes se tiennent donc côte à côte, et la
 * fréquence tombe à « — » quand le type n'en a pas — la maternité s'ouvre à la
 * naissance, pas au 1er janvier.
 */
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

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Types d&apos;absences</CardTitle>
          <p className="text-[12px] text-ink-muted">
            Ce que l&apos;agent choisit au moment de déposer sa demande.
          </p>
        </div>
        {peutGerer ? (
          <Button size="sm" onClick={() => setEdition('nouveau')}>
            <Icon name="add" size={15} className="-ml-0.5" />
            Ajouter un type
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {types.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (types.data ?? []).length === 0 ? (
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
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Type d&apos;absence</Th>
                <Th className="text-right">Jours autorisés</Th>
                <Th>Fréquence</Th>
                <Th>Règles</Th>
                {peutGerer ? <Th className="w-20 text-right">Actions</Th> : null}
              </tr>
            </THead>
            <TBody>
              {(types.data ?? []).map((t) => (
                <Tr key={t.id} className="group">
                  <Td className="font-semibold text-ink-strong">{t.name}</Td>
                  <Td className="text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {t.allowanceDays == null ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      <>
                        {t.allowanceDays} <span className="text-ink-muted">j</span>
                      </>
                    )}
                  </Td>
                  <Td>
                    {t.allowanceDays == null && t.frequency === 'none' ? (
                      <span className="text-ink-muted">—</span>
                    ) : (
                      ABSENCE_FREQUENCY_LABELS[t.frequency]
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {t.deductsBalance ? (
                        <Badge tone="primary">Décompté du solde</Badge>
                      ) : (
                        <Badge tone="neutral">Suivi seul</Badge>
                      )}
                      {t.requiresDocument ? <Badge tone="warning">Justificatif</Badge> : null}
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
        )}
      </CardContent>

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
            Il disparaît des formulaires : plus personne ne pourra déposer de demande sur ce motif.
          </p>
          {aSupprimer.usageCount > 0 ? (
            <p className="mt-3 rounded-[9px] bg-bg px-3 py-2 text-[12px] text-ink-muted">
              {aSupprimer.usageCount === 1
                ? 'La demande déjà déposée sur ce type garde son intitulé et son historique : rien n’est effacé du passé.'
                : `Les ${aSupprimer.usageCount} demandes déjà déposées sur ce type gardent leur intitulé et leur historique : rien n’est effacé du passé.`}
            </p>
          ) : null}
        </FenetreSuppression>
      ) : null}
    </Card>
  );
}

type BrouillonType = {
  name: string;
  frequency: AbsenceFrequency;
  allowanceDays: string;
  deductsBalance: boolean;
  requiresDocument: boolean;
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
    frequency: cible?.frequency ?? 'annual',
    allowanceDays: cible?.allowanceDays == null ? '' : String(cible.allowanceDays),
    deductsBalance: cible?.deductsBalance ?? true,
    requiresDocument: cible?.requiresDocument ?? false,
  });
  const [erreur, setErreur] = useState<string | null>(null);
  const set = <K extends keyof BrouillonType>(k: K, v: BrouillonType[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const quotaManquant = form.frequency !== 'none' && form.allowanceDays.trim() === '';
  const nomTropCourt = form.name.trim().length < 2;

  const enregistrer = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        deductsBalance: form.deductsBalance,
        allowanceDays: form.allowanceDays.trim() === '' ? null : Number(form.allowanceDays),
        frequency: form.frequency,
        requiresDocument: form.requiresDocument,
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
      subtitle={
        cible
          ? 'Les demandes déjà déposées gardent le paramétrage sous lequel elles ont été visées.'
          : 'Il apparaîtra aussitôt dans le formulaire de demande.'
      }
      maxWidth="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={nomTropCourt || quotaManquant}
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
        <p className="rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{erreur}</p>
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

      <ModalSection title="Droit ouvert">
        <ModalGrid>
          <Field
            label="Fréquence"
            htmlFor="typeFreq"
            hint="« Par événement » : le droit s’ouvre au fait générateur, pas au calendrier."
          >
            <Select
              id="typeFreq"
              value={form.frequency}
              onChange={(e) => set('frequency', e.target.value as AbsenceFrequency)}
            >
              {(Object.keys(ABSENCE_FREQUENCY_LABELS) as AbsenceFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {ABSENCE_FREQUENCY_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Jours autorisés"
            htmlFor="typeDays"
            required={form.frequency !== 'none'}
            error={quotaManquant ? 'Indiquez un nombre de jours pour cette fréquence.' : undefined}
            hint={form.frequency === 'none' ? 'Laissez vide s’il n’y a pas de plafond.' : undefined}
          >
            <Input
              id="typeDays"
              type="number"
              min={0}
              max={365}
              step={0.5}
              value={form.allowanceDays}
              onChange={(e) => set('allowanceDays', e.target.value)}
              placeholder="Ex : 30"
            />
          </Field>
        </ModalGrid>
      </ModalSection>

      <ModalSection title="Règles">
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2.5 text-[12.5px] text-ink">
            <Checkbox
              className="mt-0.5"
              checked={form.deductsBalance}
              onChange={(e) => set('deductsBalance', e.target.checked)}
            />
            <span>
              <span className="font-semibold text-ink-strong">Décompté du solde</span>
              <span className="block text-ink-muted">
                Les jours pris entament le droit ; sinon l’absence est seulement suivie.
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
                La demande n’est pas acceptée sans pièce jointe (certificat, ordre de mission…).
              </span>
            </span>
          </label>
        </div>
      </ModalSection>
    </Modal>
  );
}

// =============================================================================
// Jours fériés
// =============================================================================
/**
 * Les quatorze fériés sénégalais, datés ou pas encore.
 *
 * Le socle de l'année est posé à sa première consultation : les six dates
 * civiles avec leur date, les huit fêtes mobiles sans la leur. Une Korité
 * absente du tableau ne se voit pas — elle rend simplement un jour chômé
 * ouvré dans tous les décomptes, sans erreur nulle part. Sa ligne est donc là
 * dès janvier, vide, avec un calendrier à ouvrir le jour de l'annonce.
 *
 * Rien n'y est acquis pour autant : une date civile ne se déplace pas, mais
 * elle se retire — si l'Assomption cessait d'être chômée, il faudrait pouvoir
 * la sortir de la liste.
 */
function FeriesCard({ peutGerer }: { peutGerer: boolean }) {
  const queryClient = useQueryClient();
  const anneeCourante = new Date().getFullYear();
  const [annee, setAnnee] = useState(anneeCourante);
  const feries = useQuery({
    queryKey: ['holidays', annee],
    queryFn: () => api<Holiday[]>(`/holidays?year=${annee}`),
  });
  const [edition, setEdition] = useState<Holiday | 'nouveau' | null>(null);
  const [aSupprimer, setASupprimer] = useState<Holiday | null>(null);
  const rafraichir = () => void queryClient.invalidateQueries({ queryKey: ['holidays'] });

  const jour = aujourdhui();
  const lignes = feries.data ?? [];
  const colonnes = peutGerer ? 5 : 4;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <CardTitle>Jours fériés</CardTitle>
          <Select
            aria-label="Année"
            value={String(annee)}
            onChange={(e) => setAnnee(Number(e.target.value))}
            className="h-7 w-24 rounded-full text-[12px]"
          >
            {[anneeCourante - 1, anneeCourante, anneeCourante + 1, anneeCourante + 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
        {peutGerer ? (
          <Button size="sm" onClick={() => setEdition('nouveau')}>
            <Icon name="add" size={15} className="-ml-0.5" />
            Ajouter un jour férié
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {feries.isLoading ? (
          <div className="flex flex-col gap-3 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !feries.data ? (
          <EmptyState
            icon={<Icon name="error" size={22} />}
            title="Chargement impossible"
            description="Les jours fériés n’ont pas pu être chargés. Vérifiez votre connexion, puis réessayez."
            action={
              <Button size="sm" variant="secondary" onClick={() => void feries.refetch()}>
                Réessayer
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th className="w-44">Date</Th>
                <Th>Intitulé</Th>
                <Th className="w-40">Jour de la semaine</Th>
                <Th className="w-28">Statut</Th>
                {peutGerer ? <Th className="w-20 text-right">Actions</Th> : null}
              </tr>
            </THead>
            <TBody>
              {lignes.map((h) => {
                const passe = h.day != null && h.day < jour;
                const etat = statutDuJour(h.day, jour);
                return (
                  <Tr key={h.id} className={passe ? 'group bg-line-soft/70' : 'group'}>
                    <Td
                      className={passe ? 'text-ink-muted' : 'text-ink'}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {h.day != null ? (
                        formatDate(h.day)
                      ) : peutGerer ? (
                        <button
                          type="button"
                          aria-label={`Dater ${h.label} sur ${h.year}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-[12px] text-ink-muted transition-colors duration-150 hover:border-primary hover:text-primary"
                          onClick={() => setEdition(h)}
                        >
                          <Icon name="calendar_month" size={15} />
                          Définir la date
                        </button>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </Td>
                    <Td
                      className={
                        passe || h.day == null ? 'text-ink-muted' : 'font-semibold text-ink-strong'
                      }
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {h.label}
                        {h.fixed ? (
                          <Icon
                            name="lock"
                            size={13}
                            className="text-ink-muted"
                            title="Date fixe : ce jour tombe à la même date chaque année"
                          />
                        ) : null}
                      </span>
                    </Td>
                    <Td className="text-ink-muted">{h.day != null ? jourSemaine(h.day) : '—'}</Td>
                    <Td className={etat.classe}>{etat.texte}</Td>
                    {peutGerer ? (
                      <Td className="text-right">
                        <Actions
                          nom={h.label}
                          // Une date civile se retire, mais ne se déplace pas :
                          // pas de crayon, sinon le formulaire proposerait un
                          // champ que l'API refuse.
                          onModifier={h.fixed ? undefined : () => setEdition(h)}
                          onSupprimer={() => setASupprimer(h)}
                        />
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}

              {lignes.length === 0 ? (
                <Tr>
                  <Td colSpan={colonnes} className="py-8 text-center text-ink-muted">
                    Aucun jour férié sur {annee}.
                  </Td>
                </Tr>
              ) : null}
            </TBody>
          </Table>
        )}
      </CardContent>

      {edition ? (
        <FenetreFerie
          cible={edition === 'nouveau' ? null : edition}
          annee={annee}
          onClose={() => setEdition(null)}
          onEnregistre={() => {
            setEdition(null);
            rafraichir();
          }}
        />
      ) : null}

      {aSupprimer ? (
        <FenetreSuppression
          titre="Retirer ce jour férié"
          nom={
            aSupprimer.day != null
              ? `${aSupprimer.label} — ${formatDate(aSupprimer.day)}`
              : aSupprimer.label
          }
          bouton="Retirer le jour"
          chemin={`/holidays/${aSupprimer.id}`}
          onClose={() => setASupprimer(null)}
          onSupprime={() => {
            setASupprimer(null);
            rafraichir();
          }}
        >
          <p className="text-[12.5px] leading-relaxed text-ink">
            {aSupprimer.day != null
              ? 'Ce jour redevient ouvré : il sera de nouveau décompté des demandes qui l’englobent.'
              : 'Cette fête sort de la liste de l’année : elle ne pourra plus y être datée.'}
          </p>
          {aSupprimer.fixed ? (
            <p className="mt-3 rounded-[9px] bg-bg px-3 py-2 text-[12px] text-ink-muted">
              C’est un férié à date civile. Le retirer ne vaut que pour {aSupprimer.year} : les
              autres années gardent le leur.
            </p>
          ) : null}
        </FenetreSuppression>
      ) : null}
    </Card>
  );
}

function FenetreFerie({
  cible,
  annee,
  onClose,
  onEnregistre,
}: {
  cible: Holiday | null;
  annee: number;
  onClose: () => void;
  onEnregistre: () => void;
}) {
  const [day, setDay] = useState(cible?.day ?? '');
  const [label, setLabel] = useState(cible?.label ?? '');
  const [erreur, setErreur] = useState<string | null>(null);
  const anneeCible = cible?.year ?? annee;

  const enregistrer = useMutation({
    mutationFn: () => {
      // Le champ vide vaut « pas encore datée », pas la chaîne vide.
      const jour = day === '' ? null : day;
      return cible
        ? api(`/holidays/${cible.id}`, {
            method: 'PATCH',
            body: { day: jour, label: label.trim() },
          })
        : api('/holidays', {
            method: 'POST',
            body: { year: annee, day: jour, label: label.trim() },
          });
    },
    onSuccess: onEnregistre,
    onError: (err) => setErreur(messageErreur(err, 'Enregistrement impossible.')),
  });

  const aDater = cible != null && cible.day == null;
  return (
    <Modal
      open
      onClose={onClose}
      title={
        aDater ? 'Dater ce jour férié' : cible ? 'Modifier le jour férié' : 'Nouveau jour férié'
      }
      subtitle={
        aDater
          ? `Une fois datée, cette fête sera chômée et exclue des décomptes de ${anneeCible}.`
          : cible
            ? 'Une fête mobile se recale souvent la veille : les rappels déjà partis sont retirés.'
            : 'Il sera chômé pour toute l’organisation, et exclu des décomptes.'
      }
      maxWidth="max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={label.trim().length < 2}
            loading={enregistrer.isPending}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            {cible ? 'Enregistrer' : 'Ajouter le jour'}
          </Button>
        </>
      }
    >
      {erreur ? (
        <p className="rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{erreur}</p>
      ) : null}

      <ModalSection title="Le jour">
        <ModalGrid>
          <Field
            label="Date"
            htmlFor="ferieDate"
            hint="Laissez vide tant que la date n’est pas annoncée."
          >
            <Input
              id="ferieDate"
              type="date"
              autoFocus
              min={`${anneeCible}-01-01`}
              max={`${anneeCible}-12-31`}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </Field>
          <Field label="Intitulé" htmlFor="ferieLabel" required>
            <Input
              id="ferieLabel"
              list="feries-mobiles"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex : Korité"
            />
          </Field>
        </ModalGrid>
        <datalist id="feries-mobiles">
          {SENEGAL_MOBILE_HOLIDAYS.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </ModalSection>
    </Modal>
  );
}

// =============================================================================
// Circuit d'approbation
// =============================================================================

function CircuitCard({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const chain = useQuery({
    queryKey: ['approval-chain'],
    queryFn: () => api<ApprovalChain>('/approval-chain'),
  });
  const [levels, setLevels] = useState<string[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    if (chain.data) setLevels(chain.data.levels);
  }, [chain.data]);
  const saveChain = useMutation({
    mutationFn: () => api('/approval-chain', { method: 'PUT', body: { levels } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['approval-chain'] }),
    onError: (err) => setErreur(messageErreur(err, 'Enregistrement impossible.')),
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1">
        <CardTitle>Circuit d&apos;approbation</CardTitle>
        <p className="text-[12px] text-ink-muted">
          Chaque demande est visée niveau par niveau, dans l&apos;ordre. L&apos;administrateur peut
          viser n&apos;importe quel niveau.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {erreur ? (
          <p className="rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
            {erreur}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {levels.map((role, i) => (
            <div
              key={i}
              className="flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1"
            >
              <span className="text-xs text-ink-muted">{i + 1}.</span>
              <Select
                value={role}
                disabled={!isAdmin}
                aria-label={`Niveau ${i + 1}`}
                onChange={(e) => setLevels(levels.map((l, j) => (j === i ? e.target.value : l)))}
                className="h-7 w-36 border-0 bg-transparent"
              >
                {CHAIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              {isAdmin && levels.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Retirer le niveau ${i + 1}`}
                  className="text-ink-muted hover:text-danger"
                  onClick={() => setLevels(levels.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              ) : null}
            </div>
          ))}
          {isAdmin && levels.length < 5 ? (
            <Button size="sm" variant="secondary" onClick={() => setLevels([...levels, 'hr'])}>
              + Ajouter un niveau
            </Button>
          ) : null}
        </div>
        {isAdmin ? (
          <div>
            <Button
              size="sm"
              onClick={() => {
                setErreur(null);
                saveChain.mutate();
              }}
              loading={saveChain.isPending}
            >
              Enregistrer le circuit
            </Button>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">Seul un administrateur peut modifier le circuit.</p>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Communs
// =============================================================================

/**
 * Deux gestes par ligne, en gris tant qu'on ne les vise pas.
 *
 * Ils ne se cachent PAS jusqu'au survol : une ligne qui n'offre rien à voir
 * laisse croire qu'elle ne se modifie pas — et c'est précisément ce que dit,
 * elle, la mention « Date fixe » des six dates civiles. Le contraste entre les
 * deux ne tient que si les autres lignes montrent leurs gestes.
 */
function Actions({
  nom,
  onModifier,
  onSupprimer,
}: {
  nom: string;
  /** Omis quand la ligne se retire mais ne se modifie pas (date civile). */
  onModifier?: () => void;
  onSupprimer: () => void;
}) {
  const base =
    'inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors duration-150';
  return (
    <div className="flex items-center justify-end gap-0.5">
      {onModifier ? (
        <button
          type="button"
          aria-label={`Modifier ${nom}`}
          className={`${base} hover:bg-primary-soft hover:text-primary`}
          onClick={onModifier}
        >
          <Icon name="edit" size={16} />
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`Retirer ${nom}`}
        className={`${base} hover:bg-danger-soft hover:text-danger`}
        onClick={onSupprimer}
      >
        <Icon name="delete" size={16} />
      </button>
    </div>
  );
}

function FenetreSuppression({
  titre,
  nom,
  bouton,
  chemin,
  onClose,
  onSupprime,
  children,
}: {
  titre: string;
  nom: string;
  bouton: string;
  chemin: string;
  onClose: () => void;
  onSupprime: () => void;
  children: React.ReactNode;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const supprimer = useMutation({
    mutationFn: () => api(chemin, { method: 'DELETE' }),
    onSuccess: onSupprime,
    onError: (err) => setErreur(messageErreur(err, 'Suppression impossible.')),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={titre}
      subtitle={nom}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="danger"
            loading={supprimer.isPending}
            onClick={() => {
              setErreur(null);
              supprimer.mutate();
            }}
          >
            {bouton}
          </Button>
        </>
      }
    >
      {erreur ? (
        <p className="rounded-[9px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{erreur}</p>
      ) : null}
      <ModalSection title="Ce que ça change">{children}</ModalSection>
    </Modal>
  );
}
