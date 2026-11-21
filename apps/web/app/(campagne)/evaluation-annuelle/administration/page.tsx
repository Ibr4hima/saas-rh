'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdministrationDeLaCampagne,
  EvaluateurDeLAgent,
  PersonneDesignee,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  Card,
  DateInput,
  EmptyState,
  Field,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { BandeauDePage, TitreDeSection } from '../../../../components/campagne/charte';
import {
  BOUTON_DU_BANDEAU,
  periodeDeLAuto,
  periodeDeLEvaluationDuN1,
  RetourALAccueil,
} from '../../../../components/campagne/fiche';
import { ChoixDUnAgent, type AgentChoisi } from '../../../../components/complements-fiche';
import { Repere } from '../../../../components/fiche';
import { CartePleine, CorpsDefilant } from '../../../../components/gabarit';
import { messageDe } from '../../../../components/grille-evaluation';
import { Icon } from '../../../../components/icons';
import { FenetreImportEmployes } from '../../../../components/import-employes';
import { Modal } from '../../../../components/modal';
import { RechercheDuTableau, SqueletteTableau } from '../../../../components/tableau';
import { api, ApiError } from '../../../../lib/api';
import { CLE_CAMPAGNE } from '../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   L'administration de la campagne (ADR-0222), réservée aux comptes
   d'administration. En tête, l'année et ses grands nombres, avec l'import
   du fichier du personnel, le même que sur la plateforme. Puis les dates
   de l'évaluation : le début, la fin de l'auto-évaluation, la fin. Enfin,
   qui évalue qui : chaque agent à évaluer cette année, son N+1 dans
   l'organigramme, et son évaluateur pour la campagne, au choix de
   l'administration, sans toucher à l'organigramme.
   ──────────────────────────────────────────────────────────────── */

const CLE = [...CLE_CAMPAGNE, 'administration'] as const;

type Filtre = 'tous' | 'sans' | 'hors';

/** Le nom d'une personne désignée. */
const nomDe = (p: PersonneDesignee) => `${p.prenom} ${p.nom}`;

/** L'évaluateur de la campagne : le choix de l'administration, sinon le N+1 de l'organigramme. */
const evaluateurDe = (a: EvaluateurDeLAgent) => a.choisi ?? a.organigramme;

/** Un nom ou un matricule, sans accents ni capitales, pour la recherche. */
const plat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function AdministrationDeLaCampagnePage() {
  const qc = useQueryClient();
  const vue = useQuery({
    queryKey: CLE,
    queryFn: () => api<AdministrationDeLaCampagne>('/campagne/administration'),
    retry: false,
  });
  const [importOuvert, setImportOuvert] = useState(false);
  const v = vue.data;

  if (vue.error) {
    return (
      <div className="flex flex-col gap-4">
        <RetourALAccueil libelle="Accueil" />
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="settings" size={22} />}
            title={
              vue.error instanceof ApiError
                ? vue.error.problem.title
                : 'Impossible d’afficher l’administration de la campagne'
            }
          />
        </Card>
      </div>
    );
  }

  const agents = v?.agents ?? [];
  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Accueil" />
      <BandeauDePage
        icone="settings"
        titre="Administration de la campagne"
        sousTitre={v ? `Évaluation annuelle ${v.annee}` : 'Évaluation annuelle'}
        action={
          <button
            type="button"
            className={BOUTON_DU_BANDEAU}
            title="Importer l’effectif depuis un classeur .xlsx"
            onClick={() => setImportOuvert(true)}
          >
            <Icon name="upload_file" size={17} />
            Importer le personnel
          </button>
        }
        reperes={
          v
            ? [
                <Repere key="agents" label="Agents à évaluer" valeur={String(agents.length)} />,
                <Repere
                  key="sans"
                  label="Sans évaluateur"
                  valeur={String(agents.filter((a) => !evaluateurDe(a)).length)}
                  ton={agents.some((a) => !evaluateurDe(a)) ? 'attente' : undefined}
                />,
                <Repere
                  key="hors"
                  label="Évaluations hors organigramme"
                  valeur={String(agents.filter((a) => a.choisi).length)}
                />,
              ]
            : undefined
        }
      />
      {v ? <Dates key={JSON.stringify(v.periode)} vue={v} /> : null}
      <QuiEvalueQui vue={v} />
      {importOuvert ? (
        <FenetreImportEmployes
          onClose={() => {
            setImportOuvert(false);
            // Des agents peuvent arriver, ou changer de N+1.
            void qc.invalidateQueries({ queryKey: CLE_CAMPAGNE });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Les dates de l'évaluation : le début de la période, la fin de
 * l'auto-évaluation, la fin de la période. Dessous, les deux temps tels que
 * les agents les liront sur leur accueil.
 */
function Dates({ vue: v }: { vue: AdministrationDeLaCampagne }) {
  const qc = useQueryClient();
  const [du, setDu] = useState(v.periode?.du ?? '');
  const [autoAu, setAutoAu] = useState(v.periode?.autoAu ?? '');
  const [au, setAu] = useState(v.periode?.au ?? '');
  const enregistrer = useMutation({
    mutationFn: () =>
      api<AdministrationDeLaCampagne>('/campagne/administration/dates', {
        method: 'PUT',
        body: { du, autoAu, au },
      }),
    onSuccess: async (nouvelle) => {
      qc.setQueryData(CLE, nouvelle);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
    },
  });
  const autoAvant = du !== '' && autoAu !== '' && autoAu < du;
  const finAvant = autoAu !== '' && au !== '' && au < autoAu;
  const complete = du !== '' && autoAu !== '' && au !== '' && !autoAvant && !finAvant;
  const change =
    du !== (v.periode?.du ?? '') ||
    autoAu !== (v.periode?.autoAu ?? '') ||
    au !== (v.periode?.au ?? '');
  const apercu = complete ? { du, autoAu, au } : null;

  return (
    <section aria-labelledby="dates-de-l-evaluation" className="mt-5 flex flex-col gap-4">
      <TitreDeSection id="dates-de-l-evaluation">Dates de l’évaluation</TitreDeSection>
      <Card>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          <Field label="Début de la période" htmlFor="periode-du" required>
            <DateInput id="periode-du" value={du} onChange={(e) => setDu(e.target.value)} />
          </Field>
          <Field
            label="Fin de l’auto-évaluation"
            htmlFor="periode-auto"
            required
            error={
              autoAvant
                ? 'La fin de l’auto-évaluation doit suivre le début de la période'
                : undefined
            }
          >
            <DateInput
              id="periode-auto"
              min={du || undefined}
              value={autoAu}
              aria-invalid={autoAvant || undefined}
              onChange={(e) => setAutoAu(e.target.value)}
            />
          </Field>
          <Field
            label="Fin de la période"
            htmlFor="periode-au"
            required
            error={
              finAvant ? 'La fin de la période doit suivre la fin de l’auto-évaluation' : undefined
            }
          >
            <DateInput
              id="periode-au"
              min={autoAu || du || undefined}
              value={au}
              aria-invalid={finAvant || undefined}
              onChange={(e) => setAu(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-3 border-t border-line-soft px-5 py-3.5 sm:flex-row sm:items-center sm:gap-5">
          <dl className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-muted">
            {apercu ? (
              <>
                <div>
                  <dt className="inline font-semibold text-ink">Auto-évaluation : </dt>
                  <dd className="inline">{periodeDeLAuto(apercu)}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-ink">Évaluation : </dt>
                  <dd className="inline">{periodeDeLEvaluationDuN1(apercu)}</dd>
                </div>
              </>
            ) : null}
          </dl>
          {enregistrer.error ? (
            <p role="alert" className="text-[12px] text-danger">
              {messageDe(enregistrer.error)}
            </p>
          ) : null}
          <Button
            className="h-9 shrink-0 px-5"
            disabled={!complete || !change}
            loading={enregistrer.isPending}
            onClick={() => enregistrer.mutate()}
          >
            Enregistrer
          </Button>
        </div>
      </Card>
    </section>
  );
}

/**
 * Qui évalue qui : chaque agent à évaluer cette année, son N+1 dans
 * l'organigramme, et son évaluateur pour la campagne. On cherche un agent
 * par son nom ou son matricule, et on filtre les agents sans évaluateur, ou
 * les évaluations hors organigramme.
 */
function QuiEvalueQui({ vue: v }: { vue: AdministrationDeLaCampagne | undefined }) {
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [ouvert, setOuvert] = useState<EvaluateurDeLAgent | null>(null);
  const agents = v?.agents ?? [];
  const cherche = plat(recherche.trim());
  const visibles = agents.filter(
    (a) =>
      (filtre === 'tous' ||
        (filtre === 'sans' && !evaluateurDe(a)) ||
        (filtre === 'hors' && a.choisi)) &&
      (!cherche ||
        plat(`${a.prenom} ${a.nom}`).includes(cherche) ||
        plat(a.matricule).includes(cherche)),
  );

  return (
    <section aria-labelledby="qui-evalue-qui" className="mt-5 flex flex-col gap-4">
      <TitreDeSection
        id="qui-evalue-qui"
        droite={
          <>
            <RechercheDuTableau
              valeur={recherche}
              onChange={setRecherche}
              placeholder="Nom ou matricule…"
              libelle="Rechercher un agent"
            />
            <Select
              aria-label="Évaluateur"
              value={filtre}
              onChange={(e) => setFiltre(e.target.value as Filtre)}
              className="h-8 w-auto text-[12.5px]"
            >
              <option value="tous">Tous les agents</option>
              <option value="sans">Sans évaluateur</option>
              <option value="hors">Hors organigramme</option>
            </Select>
          </>
        }
      >
        Qui évalue qui
      </TitreDeSection>
      <CartePleine>
        {!v ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : visibles.length === 0 ? (
          <CorpsDefilant className="grid place-items-center py-10">
            <EmptyState
              icon={<Icon name="groups" size={22} />}
              title={agents.length === 0 ? 'Aucun agent à évaluer' : 'Aucun résultat'}
            />
          </CorpsDefilant>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Agent</Th>
                <Th className="max-md:hidden">Direction</Th>
                <Th className="max-lg:hidden">N+1 dans l’organigramme</Th>
                <Th className="max-sm:hidden">Évaluateur de la campagne</Th>
                <Th>
                  <span className="sr-only">Modifier</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {visibles.map((a) => (
                <Ligne key={a.employeeId} agent={a} onModifier={() => setOuvert(a)} />
              ))}
            </TBody>
          </Table>
        )}
      </CartePleine>
      {ouvert ? <FenetreEvaluateur agent={ouvert} onClose={() => setOuvert(null)} /> : null}
    </section>
  );
}

/** L'évaluateur d'un agent, dans sa cellule : son nom, et « Hors organigramme » s'il y a lieu. */
function Evaluateur({ agent: a }: { agent: EvaluateurDeLAgent }) {
  const e = evaluateurDe(a);
  if (!e) return <Badge tone="orange">À désigner</Badge>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold text-ink-strong">{nomDe(e)}</span>
      {a.choisi ? <Badge tone="teal">Hors organigramme</Badge> : null}
    </span>
  );
}

function Ligne({ agent: a, onModifier }: { agent: EvaluateurDeLAgent; onModifier: () => void }) {
  return (
    <Tr>
      <Td>
        <span className="block font-semibold text-ink-strong">
          {a.prenom} {a.nom}
        </span>
        <span className="font-mono text-[11px] tracking-tight text-ink-muted">{a.matricule}</span>
        {/* Sur un téléphone, l'évaluateur passe sous le nom. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:hidden">
          <span className="text-[12px] text-ink-muted">Évaluateur :</span>
          <Evaluateur agent={a} />
        </div>
      </Td>
      <Td className="max-md:hidden">{a.direction}</Td>
      <Td className="max-lg:hidden">{a.organigramme ? nomDe(a.organigramme) : null}</Td>
      <Td className="max-sm:hidden">
        <Evaluateur agent={a} />
      </Td>
      <Td className="w-12 text-right">
        <button
          type="button"
          onClick={onModifier}
          disabled={a.transmise}
          aria-label={`Évaluateur de ${a.prenom} ${a.nom}`}
          title={a.transmise ? 'Fiche transmise à la DCH' : 'Modifier l’évaluateur'}
          className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-primary/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40"
        >
          <Icon name="edit" size={17} />
        </button>
      </Td>
    </Tr>
  );
}

/**
 * Le choix de l'évaluateur d'un agent : tout agent en activité. Revenir à
 * l'organigramme rend la fiche au N+1 de l'organigramme.
 */
function FenetreEvaluateur({
  agent: a,
  onClose,
}: {
  agent: EvaluateurDeLAgent;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const actuel = evaluateurDe(a);
  const [choisi, setChoisi] = useState<AgentChoisi | null>(
    actuel ? { id: actuel.employeeId, nom: nomDe(actuel), matricule: actuel.matricule } : null,
  );
  const enregistrer = useMutation({
    mutationFn: (evaluateurEmployeeId: string | null) =>
      api<AdministrationDeLaCampagne>(`/campagne/administration/evaluateurs/${a.employeeId}`, {
        method: 'PUT',
        body: { evaluateurEmployeeId },
      }),
    onSuccess: async (nouvelle) => {
      qc.setQueryData(CLE, nouvelle);
      await qc.invalidateQueries({ queryKey: CLE_CAMPAGNE, exact: true });
      onClose();
    },
  });
  const enCours = (id: string | null) => enregistrer.isPending && enregistrer.variables === id;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Évaluateur de ${a.prenom} ${a.nom}`}
      maxWidth="max-w-md"
      footer={
        <>
          {a.choisi && a.organigramme ? (
            <Button
              variant="secondary"
              className="mr-auto"
              loading={enCours(null)}
              onClick={() => enregistrer.mutate(null)}
            >
              Revenir à l’organigramme
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={!choisi || choisi.id === actuel?.employeeId}
            loading={choisi ? enCours(choisi.id) : false}
            onClick={() => choisi && enregistrer.mutate(choisi.id)}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          <dt className="text-ink-muted">Matricule</dt>
          <dd className="font-mono tracking-tight text-ink-strong">{a.matricule}</dd>
          <dt className="text-ink-muted">N+1 dans l’organigramme</dt>
          <dd className="font-semibold text-ink-strong">
            {a.organigramme ? nomDe(a.organigramme) : 'Aucun'}
          </dd>
        </dl>
        <Field label="Évaluateur de la campagne" htmlFor="evaluateur" required>
          <ChoixDUnAgent
            id="evaluateur"
            agent={choisi}
            exclure={a.employeeId}
            onChoisir={setChoisi}
          />
        </Field>
        {enregistrer.error ? (
          <p role="alert" className="text-[12px] text-danger">
            {messageDe(enregistrer.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
