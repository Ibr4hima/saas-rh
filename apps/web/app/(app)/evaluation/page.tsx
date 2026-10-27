'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LIBELLES_PERSONNEL,
  nomDeLaGrille,
  periodeDEvaluationEnLettres,
  PERSONNELS,
  type LigneDEvaluation,
  type OuEnEst,
  type Personnel,
  type SuiviDesEvaluations,
  type VueDeLaPeriode,
} from '@teranga/contracts';
import {
  Badge,
  Button,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
} from '@teranga/ui';
import { api, apiUrl } from '../../../lib/api';
import { formatDate } from '../../../lib/hooks';
import type { ViewableDoc } from '../../../components/doc-viewer';
import { FenetreDocument } from '../../../components/fenetre-document';
import { EnTete, Repere } from '../../../components/fiche';
import { CartePleine, CorpsDefilant, Page } from '../../../components/gabarit';
import {
  anneeDeLAdresse,
  CLE_EVALUATIONS,
  Erreur,
  messageDe,
} from '../../../components/grille-evaluation';
import { Icon } from '../../../components/icons';
import { Modal, ModalGrid } from '../../../components/modal';
import { Onglets, OngletsDeLEntete } from '../../../components/onglets';
import { RechercheDuTableau, SqueletteTableau } from '../../../components/tableau';

/*
   L'évaluation annuelle, côté DCH (ADR-0149). Qui dirige la DCH fixe la
   période de chaque année, du … au … ; la DCH suit chaque agent qu'on
   évalue, où en est sa grille, et reçoit en PDF celles que les N+1 lui
   transmettent. Une année se choisit dans l'en-tête : celles qui ont une
   période, et l'année en cours pour en fixer une. Qui gère le personnel dit
   aussi, ligne par ligne, si l'agent est cadre ou non cadre : la fiche de
   l'agent change avec, comme si le choix y avait été fait.

   Le tableau ne garde que deux statuts : un agent est évalué quand sa grille
   est transmise à la DCH, non évalué avant ; « En retard » s'y ajoute passé
   la fin de la période. Les étapes du circuit restent au N+1 ; l'en-tête en
   compte les grandes lignes.
*/

type Filtre = 'tous' | 'evalues' | 'non_evalues' | 'en_retard';

const FILTRES: { cle: Filtre; label: string }[] = [
  { cle: 'tous', label: 'Tous les statuts' },
  { cle: 'evalues', label: 'Évalués' },
  { cle: 'non_evalues', label: 'Non évalués' },
  { cle: 'en_retard', label: 'En retard' },
];

const EN_COURS: OuEnEst[] = [
  'en_cours',
  'renvoyee',
  'chez_agent',
  'validee_agent',
  'chez_n2',
  'validee_n2',
];

/** Évalué : la grille de l'agent est transmise à la DCH. */
const evalue = (l: LigneDEvaluation) => l.ouEnEst === 'terminee';

function retenue(l: LigneDEvaluation, filtre: Filtre): boolean {
  switch (filtre) {
    case 'evalues':
      return evalue(l);
    case 'non_evalues':
      return !evalue(l);
    case 'en_retard':
      return l.enRetard;
    default:
      return true;
  }
}

/** Sans accents ni capitales : « Ndiaye » se trouve en tapant « ndi ». */
const plat = (texte: string) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function EvaluationPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const demandee = anneeDeLAdresse(useSearchParams().get('annee'));
  const cleDuSuivi = [...CLE_EVALUATIONS, 'suivi', demandee] as const;
  const suivi = useQuery({
    queryKey: cleDuSuivi,
    queryFn: () =>
      api<SuiviDesEvaluations>(`/evaluations/suivi${demandee ? `?annee=${demandee}` : ''}`),
    placeholderData: (precedent) => precedent,
  });
  // Cadre ou non cadre : la colonne de la fiche de l'agent, sa propre ligne
  // comprise (ADR-0157). La ligne change tout de suite ; un refus la remet
  // comme elle était.
  const [erreurPersonnel, setErreurPersonnel] = useState<string | null>(null);
  const changerPersonnel = useMutation({
    mutationFn: ({ employeeId, personnel }: { employeeId: string; personnel: Personnel }) =>
      api(`/evaluations/personnel/${employeeId}`, { method: 'PUT', body: { personnel } }),
    onMutate: async ({ employeeId, personnel }) => {
      setErreurPersonnel(null);
      await qc.cancelQueries({ queryKey: cleDuSuivi });
      const avant = qc.getQueryData<SuiviDesEvaluations>(cleDuSuivi);
      qc.setQueryData<SuiviDesEvaluations>(cleDuSuivi, (s) =>
        s
          ? {
              ...s,
              lignes: s.lignes.map((l) => (l.employeeId === employeeId ? { ...l, personnel } : l)),
            }
          : s,
      );
      return { avant };
    },
    onError: (e, _variables, contexte) => {
      if (contexte?.avant) qc.setQueryData(cleDuSuivi, contexte.avant);
      setErreurPersonnel(messageDe(e, 'Modification impossible, réessayez.'));
    },
    onSettled: (_reponse, _erreur, { employeeId }) => {
      void qc.invalidateQueries({ queryKey: CLE_EVALUATIONS });
      void qc.invalidateQueries({ queryKey: ['employee', employeeId] });
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
  });
  const choixDuPersonnel = (l: LigneDEvaluation) => (
    <ChoixDuPersonnel
      ligne={l}
      enCours={
        changerPersonnel.isPending && changerPersonnel.variables?.employeeId === l.employeeId
      }
      onChange={(personnel) => changerPersonnel.mutate({ employeeId: l.employeeId, personnel })}
    />
  );
  const [periodeOuverte, setPeriodeOuverte] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('tous');
  const [apercu, setApercu] = useState<{ doc: ViewableDoc; telechargement: string } | null>(null);

  const v = suivi.data;
  const annees = v
    ? [...new Set([new Date().getFullYear(), v.annee, ...v.annees])].sort((x, y) => y - x)
    : [];
  const onglets = annees.map((a) => ({ cle: String(a), label: String(a) }));
  const choisir = (cle: string) => router.replace(`/evaluation?annee=${cle}`, { scroll: false });

  const lignes = v?.lignes ?? [];
  const compte = (garde: (l: LigneDEvaluation) => boolean) => lignes.filter(garde).length;
  const enRetard = compte((l) => l.enRetard);
  const cherche = plat(recherche.trim());
  const visibles = lignes.filter(
    (l) =>
      retenue(l, filtre) &&
      (!cherche ||
        [l.nom, l.matricule, l.direction, l.n1].some((x) => x && plat(x).includes(cherche))),
  );

  const ouvrir = (l: LigneDEvaluation, annee: number) => {
    const chemin = `/evaluations/grilles/${l.employeeId}/${annee}/pdf`;
    setApercu({
      doc: {
        url: apiUrl(`${chemin}?disposition=inline`),
        filename: nomDeLaGrille(annee, l.matricule),
        contentType: 'application/pdf',
        titre: `Grille d’évaluation ${annee} de ${l.nom}`,
      },
      telechargement: apiUrl(chemin),
    });
  };

  return (
    <Page>
      {onglets.length > 1 && v ? (
        <>
          <OngletsDeLEntete courant={String(v.annee)} onChange={choisir} onglets={onglets} />
          <Onglets
            courant={String(v.annee)}
            onChange={choisir}
            onglets={onglets}
            label="Choisir l’année"
            className="w-max lg:hidden"
          />
        </>
      ) : null}

      {v ? (
        <EnTete
          titre={`Évaluation annuelle ${v.annee}`}
          sousTitre={
            v.periode
              ? `Période d’évaluation ${periodeDEvaluationEnLettres(v.periode)}`
              : 'Période d’évaluation non fixée'
          }
          action={
            !v.modifiable ? null : v.periode ? (
              <button
                type="button"
                onClick={() => setPeriodeOuverte(true)}
                aria-label="Modifier la période"
                title="Modifier la période"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-muted transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.06] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
              >
                <Icon name="edit" size={18} />
              </button>
            ) : (
              <Button className="h-9" onClick={() => setPeriodeOuverte(true)}>
                <Icon name="event" size={16} />
                Fixer la période
              </Button>
            )
          }
          reperes={
            <>
              <Repere label="À remplir" valeur={String(compte((l) => l.ouEnEst === 'a_remplir'))} />
              <Repere
                label="En cours"
                valeur={String(compte((l) => EN_COURS.includes(l.ouEnEst)))}
              />
              <Repere label="Évalués" valeur={String(compte(evalue))} />
              <Repere
                label="En retard"
                valeur={String(enRetard)}
                ton={enRetard > 0 ? 'attente' : undefined}
              />
            </>
          }
        />
      ) : (
        <Skeleton className="h-[158px] w-full rounded-bloc" />
      )}

      <CartePleine>
        <CardHeader className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <CardTitle>Agents à évaluer</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <RechercheDuTableau
              valeur={recherche}
              onChange={setRecherche}
              placeholder="Nom ou matricule…"
              libelle="Rechercher un agent"
            />
            <Select
              aria-label="Statut"
              value={filtre}
              onChange={(e) => setFiltre(e.target.value as Filtre)}
              className="h-8 w-auto text-[12.5px]"
            >
              {FILTRES.map((f) => (
                <option key={f.cle} value={f.cle}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        {erreurPersonnel ? (
          <div className="shrink-0 px-5">
            <Erreur>{erreurPersonnel}</Erreur>
          </div>
        ) : null}
        {!v ? (
          <CorpsDefilant>
            <SqueletteTableau />
          </CorpsDefilant>
        ) : visibles.length === 0 ? (
          <CorpsDefilant className="grid place-items-center">
            <EmptyState
              icon={<Icon name="rate_review" size={22} />}
              title={lignes.length === 0 ? 'Aucun agent à évaluer' : 'Aucun résultat'}
            />
          </CorpsDefilant>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Agent</Th>
                <Th className="max-md:hidden">Direction</Th>
                <Th className="max-lg:hidden">N+1</Th>
                <Th className="max-sm:hidden">Personnel</Th>
                <Th>Statut</Th>
                <Th className="max-sm:hidden">Date</Th>
                <Th>
                  <span className="sr-only">Grille</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {visibles.map((l) => (
                <Tr key={l.employeeId}>
                  <Td>
                    <Link
                      href={`/employees/${l.employeeId}`}
                      className="block font-semibold text-ink-strong hover:text-primary"
                    >
                      {l.nom}
                    </Link>
                    <span className="font-mono text-[11px] tracking-tight text-ink-muted">
                      {l.matricule}
                    </span>
                    {/* Sur un téléphone, la colonne « Personnel » n'a pas la
                        place : le choix passe sous le nom. */}
                    <div className="mt-2 sm:hidden">{choixDuPersonnel(l)}</div>
                  </Td>
                  <Td className="max-md:hidden">{l.direction}</Td>
                  <Td className="max-lg:hidden">{l.n1}</Td>
                  <Td className="max-sm:hidden">{choixDuPersonnel(l)}</Td>
                  <Td>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {evalue(l) ? (
                        <Badge tone="vert">Évalué</Badge>
                      ) : (
                        <Badge tone="gris">Non évalué</Badge>
                      )}
                      {l.enRetard ? (
                        <span className="text-[11.5px] font-semibold text-accent-text">
                          En retard
                        </span>
                      ) : null}
                    </span>
                  </Td>
                  {/* Le jour où la grille est arrivée à la DCH. */}
                  <Td className="text-ink-muted tabular-nums max-sm:hidden">
                    {l.le && evalue(l) ? formatDate(l.le) : null}
                  </Td>
                  <Td className="w-12 text-right">
                    {l.ouEnEst === 'terminee' ? (
                      <button
                        type="button"
                        onClick={() => ouvrir(l, v.annee)}
                        aria-label={`Grille d’évaluation de ${l.nom}`}
                        title="Voir la grille"
                        className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-primary/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                      >
                        <Icon name="picture_as_pdf" size={18} />
                      </button>
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </CartePleine>

      {periodeOuverte && v ? (
        <FenetrePeriode suivi={v} onClose={() => setPeriodeOuverte(false)} />
      ) : null}
      <FenetreDocument
        doc={apercu?.doc ?? null}
        telechargement={apercu?.telechargement}
        onClose={() => setApercu(null)}
      />
    </Page>
  );
}

/**
 * Cadre ou non cadre, dans la ligne d'un agent. Qui gère le personnel le
 * choisit dans la liste, pour tout dossier en activité, le sien compris
 * (ADR-0157) ; sinon, la colonne se lit seulement. Tant que rien n'est
 * choisi, « À renseigner » reste en évidence ; une fois le choix fait, il
 * quitte la liste.
 */
function ChoixDuPersonnel({
  ligne: l,
  enCours,
  onChange,
}: {
  ligne: LigneDEvaluation;
  enCours: boolean;
  onChange: (personnel: Personnel) => void;
}) {
  if (!l.personnelModifiable) {
    return l.personnel ? (
      <>{LIBELLES_PERSONNEL[l.personnel]}</>
    ) : (
      <span className="font-semibold text-accent-text">À renseigner</span>
    );
  }
  return (
    <Select
      aria-label={`Personnel de ${l.nom}`}
      value={l.personnel ?? ''}
      disabled={enCours}
      onChange={(e) => onChange(e.target.value as Personnel)}
      className={cn(
        'h-8 w-[136px] text-[12.5px]',
        !l.personnel && 'font-semibold text-accent-text',
      )}
    >
      {l.personnel ? null : (
        <option value="" disabled>
          À renseigner
        </option>
      )}
      {PERSONNELS.map((p) => (
        <option key={p} value={p}>
          {LIBELLES_PERSONNEL[p]}
        </option>
      ))}
    </Select>
  );
}

/** La période d'évaluation d'une année : du … au …, que fixe qui dirige la DCH. */
function FenetrePeriode({ suivi, onClose }: { suivi: SuiviDesEvaluations; onClose: () => void }) {
  const qc = useQueryClient();
  const { annee } = suivi;
  const [du, setDu] = useState(suivi.periode?.du ?? `${annee}-12-01`);
  const [au, setAu] = useState(suivi.periode?.au ?? `${annee}-12-31`);
  const [erreur, setErreur] = useState<string | null>(null);
  const enregistrer = useMutation({
    mutationFn: () =>
      api<VueDeLaPeriode>(`/evaluations/periode/${annee}`, { method: 'PUT', body: { du, au } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: CLE_EVALUATIONS });
      onClose();
    },
    onError: (e) => setErreur(messageDe(e, 'Enregistrement impossible.')),
  });
  const inverse = du !== '' && au !== '' && au < du;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Période d’évaluation ${annee}`}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={!du || !au || inverse}
            loading={enregistrer.isPending}
            onClick={() => {
              setErreur(null);
              enregistrer.mutate();
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      {erreur ? <Erreur>{erreur}</Erreur> : null}
      <ModalGrid>
        <Field label="Du" htmlFor="periode-du" required>
          <Input id="periode-du" type="date" value={du} onChange={(e) => setDu(e.target.value)} />
        </Field>
        <Field
          label="Au"
          htmlFor="periode-au"
          required
          error={inverse ? 'La fin de la période doit être après son début' : undefined}
        >
          <Input
            id="periode-au"
            type="date"
            min={du || undefined}
            value={au}
            aria-invalid={inverse || undefined}
            onChange={(e) => setAu(e.target.value)}
          />
        </Field>
      </ModalGrid>
    </Modal>
  );
}
