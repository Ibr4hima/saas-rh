'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TITRE_DE_LA_FICHE,
  type EtapeDeLaFiche,
  type FicheSuivie,
  type SuiviDeLaDCH,
} from '@teranga/contracts';
import {
  Badge,
  Card,
  EmptyState,
  Select,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  type BadgeTone,
} from '@teranga/ui';
import { jourCourt, RetourALAccueil } from '../../../../components/campagne/fiche';
import { Repere } from '../../../../components/fiche';
import { BandeauDePage, TitreDeSection } from '../../../../components/campagne/charte';
import { CartePleine, CorpsDefilant } from '../../../../components/gabarit';
import { Icon } from '../../../../components/icons';
import { RechercheDuTableau, SqueletteTableau } from '../../../../components/tableau';
import { api, ApiError } from '../../../../lib/api';
import { CLE_CAMPAGNE, ficheDeLaDCH } from '../../../../lib/campagne';

/* ────────────────────────────────────────────────────────────────
   Le suivi des évaluations (ADR-0221, ADR-0256) : chaque agent à évaluer
   cette année, et où en est sa fiche, de l'auto-évaluation à sa
   transmission à la DCH. En tête, les grands nombres ; dessous, la liste,
   qu'on cherche par nom ou matricule et qu'on filtre par étape. Une fiche
   transmise s'ouvre en entier. La page demande l'habilitation « Tableau de
   bord » ; elle s'ouvre depuis le bouton « Suivi des évaluations » de la
   barre du haut.
   ──────────────────────────────────────────────────────────────── */

/** L'auto-évaluation n'a que deux états : faite, ou non faite, en rouge (ADR-0226). */
const ETAPES: Record<EtapeDeLaFiche, { libelle: string; ton: BadgeTone }> = {
  auto_non_faite: { libelle: 'Auto-évaluation non faite', ton: 'rouge' },
  chez_le_n1: { libelle: 'Chez le N+1', ton: 'bleu' },
  chez_l_agent: { libelle: 'Chez l’agent', ton: 'teal' },
  chez_le_n2: { libelle: 'Chez le N+2', ton: 'teal' },
  a_transmettre: { libelle: 'À transmettre par le N+1', ton: 'orange' },
  transmise: { libelle: 'Transmise à la DCH', ton: 'vert' },
};

const ORDRE = Object.keys(ETAPES) as EtapeDeLaFiche[];

/** Un nom ou un matricule, sans accents ni capitales, pour la recherche. */
const plat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SuiviDeLaDCHPage() {
  const suivi = useQuery({
    queryKey: [...CLE_CAMPAGNE, 'dch'],
    queryFn: () => api<SuiviDeLaDCH>('/campagne/dch'),
    retry: false,
  });
  const [recherche, setRecherche] = useState('');
  const [etape, setEtape] = useState<EtapeDeLaFiche | 'toutes'>('toutes');
  const v = suivi.data;

  if (suivi.error) {
    return (
      <div className="flex flex-col gap-4">
        <RetourALAccueil libelle="Accueil" />
        <Card>
          <EmptyState
            className="py-12"
            icon={<Icon name="folder_managed" size={22} />}
            title={
              suivi.error instanceof ApiError
                ? suivi.error.problem.title
                : 'Impossible d’afficher le suivi des évaluations'
            }
          />
        </Card>
      </div>
    );
  }

  const fiches = v?.fiches ?? [];
  const compte = (...etapes: EtapeDeLaFiche[]) =>
    fiches.filter((f) => etapes.includes(f.etape)).length;
  const cherche = plat(recherche.trim());
  const visibles = fiches.filter(
    (f) =>
      (etape === 'toutes' || f.etape === etape) &&
      (!cherche ||
        plat(`${f.prenom} ${f.nom}`).includes(cherche) ||
        plat(f.matricule).includes(cherche)),
  );

  return (
    <div className="flex flex-col gap-4">
      <RetourALAccueil libelle="Accueil" />
      <BandeauDePage
        icone="folder_managed"
        titre="Suivi des évaluations"
        sousTitre={v ? `${TITRE_DE_LA_FICHE} ${v.annee}` : TITRE_DE_LA_FICHE}
        reperes={
          v
            ? [
                <Repere key="agents" label="Agents à évaluer" valeur={String(fiches.length)} />,
                <Repere
                  key="autos"
                  label="Auto-évaluations faites"
                  valeur={String(fiches.length - compte('auto_non_faite'))}
                />,
                <Repere
                  key="validees"
                  label="Validées par l’agent"
                  valeur={String(compte('chez_le_n2', 'a_transmettre', 'transmise'))}
                />,
                <Repere
                  key="transmises"
                  label="Transmises à la DCH"
                  valeur={String(compte('transmise'))}
                />,
              ]
            : undefined
        }
      />

      {/* Les fiches de l'année : le titre en Anton, la recherche et le filtre
          à sa droite, le tableau dans la carte (ADR-0233). */}
      <section aria-labelledby="fiches-de-l-annee" className="mt-5 flex flex-col gap-4">
        <TitreDeSection
          id="fiches-de-l-annee"
          droite={
            <>
              <RechercheDuTableau
                valeur={recherche}
                onChange={setRecherche}
                placeholder="Nom ou matricule…"
                libelle="Rechercher un agent"
              />
              <Select
                aria-label="Étape"
                value={etape}
                onChange={(e) => setEtape(e.target.value as EtapeDeLaFiche | 'toutes')}
                className="h-8 w-auto text-[12.5px]"
              >
                <option value="toutes">Toutes les étapes</option>
                {ORDRE.map((e) => (
                  <option key={e} value={e}>
                    {ETAPES[e].libelle}
                  </option>
                ))}
              </Select>
            </>
          }
        >
          Fiches de l’année
        </TitreDeSection>
        <CartePleine>
          {!v ? (
            <CorpsDefilant>
              <SqueletteTableau />
            </CorpsDefilant>
          ) : visibles.length === 0 ? (
            <CorpsDefilant className="grid place-items-center py-10">
              <EmptyState
                icon={<Icon name="rate_review" size={22} />}
                title={fiches.length === 0 ? 'Aucun agent à évaluer' : 'Aucun résultat'}
              />
            </CorpsDefilant>
          ) : (
            <Table>
              <THead>
                <tr>
                  <Th>Agent</Th>
                  <Th className="max-md:hidden">Direction</Th>
                  <Th className="max-lg:hidden">N+1</Th>
                  <Th className="max-sm:hidden">Étape</Th>
                  <Th className="max-sm:hidden">Transmise le</Th>
                  <Th>
                    <span className="sr-only">Fiche</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {visibles.map((f) => (
                  <Ligne key={f.employeeId} fiche={f} />
                ))}
              </TBody>
            </Table>
          )}
        </CartePleine>
      </section>
    </div>
  );
}

/** Un agent du suivi : son nom et son matricule, sa direction, son N+1, l'étape de sa fiche. */
function Ligne({ fiche: f }: { fiche: FicheSuivie }) {
  const etape = ETAPES[f.etape];
  const transmise = f.etape === 'transmise';
  const nom = `${f.prenom} ${f.nom}`;
  return (
    <Tr>
      <Td>
        {transmise ? (
          <Link
            href={ficheDeLaDCH(f.employeeId)}
            className="block font-semibold text-ink-strong hover:text-primary"
          >
            {nom}
          </Link>
        ) : (
          <span className="block font-semibold text-ink-strong">{nom}</span>
        )}
        <span className="font-mono text-[11px] tracking-tight text-ink-muted">{f.matricule}</span>
        {/* Sur un téléphone, la colonne « Étape » n'a pas la place : l'étape passe sous le nom. */}
        <div className="mt-2 sm:hidden">
          <Badge tone={etape.ton}>{etape.libelle}</Badge>
        </div>
      </Td>
      <Td className="max-md:hidden">{f.direction}</Td>
      <Td className="max-lg:hidden">{f.n1 ? `${f.n1.prenom} ${f.n1.nom}` : null}</Td>
      <Td className="max-sm:hidden">
        <Badge tone={etape.ton}>{etape.libelle}</Badge>
      </Td>
      <Td className="text-ink-muted tabular-nums max-sm:hidden">
        {f.transmiseLe ? jourCourt(f.transmiseLe) : null}
      </Td>
      <Td className="w-12 text-right">
        {transmise ? (
          <Link
            href={ficheDeLaDCH(f.employeeId)}
            aria-label={`Fiche de ${nom}`}
            title="Ouvrir la fiche"
            className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors duration-150 hover:bg-primary/[0.08] hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          >
            <Icon name="chevron_right" size={18} />
          </Link>
        ) : null}
      </Td>
    </Tr>
  );
}
