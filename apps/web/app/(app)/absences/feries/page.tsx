'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { Holiday } from '@teranga/contracts';
import { SENEGAL_MOBILE_HOLIDAYS } from '@teranga/contracts';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import {
  Actions,
  FenetreSuppression,
  messageErreur,
} from '../../../../components/reglages-absences';
import { api } from '../../../../lib/api';
import { formatDate, useMe } from '../../../../lib/hooks';

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

export default function JoursFeriesPage() {
  const me = useMe();
  const peutGerer = me.data?.role === 'admin' || me.data?.role === 'hr';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link href="/absences" className="text-sm text-ink-muted hover:text-ink">
          ← Congés
        </Link>
      </div>
      <FeriesCard peutGerer={peutGerer} />
    </div>
  );
}

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
